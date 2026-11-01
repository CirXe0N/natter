package live

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/nats-io/nats-server/v2/server"
	"github.com/nats-io/nats.go"
	"golang.org/x/time/rate"

	"github.com/CirXe0N/natter/internal/api"
	"github.com/CirXe0N/natter/internal/contexts"
	"github.com/CirXe0N/natter/internal/natstest"
	"github.com/CirXe0N/natter/internal/vault"
)

// startTail runs a Tail of filter on the app Context of a fresh embedded
// server. It returns the server, a publisher, and the tail's decoded frames.
func startTail(t *testing.T, filter string, budget int) (*server.Server, *nats.Conn, *Tail, <-chan api.Tail) {
	t.Helper()
	ns, err := natstest.Start(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(ns.Shutdown)
	root := t.TempDir()
	if err := natstest.WriteContext(root, "app", map[string]string{"url": ns.ClientURL(), "user": "app", "password": "app"}); err != nil {
		t.Fatal(err)
	}
	m := contexts.New(root, vault.Open(t.TempDir()))
	t.Cleanup(m.Close)
	if err := m.Activate(t.Context(), api.Ref{Source: api.SourceCLI, Name: "app"}); err != nil {
		t.Fatal(err)
	}
	pub, err := nats.Connect(ns.ClientURL(), nats.UserInfo("app", "app"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pub.Close)

	tail := NewTail(filter, m)
	tail.Budget = budget
	frames := make(chan api.Tail, 1000)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	go tail.Run(ctx, func(b []byte, _ bool) {
		var f api.ServerFrame
		if err := json.Unmarshal(b, &f); err != nil || f.Topic != api.Topic("tail:"+filter) || f.Tail == nil {
			t.Errorf("frame %s: %v", b, err)
			return
		}
		frames <- *f.Tail
	})
	eventually(t, "the tail's own connection never subscribed", func() bool {
		c, _ := ns.Connz(&server.ConnzOptions{})
		for _, ci := range c.Conns {
			if ci.Name == "Natter live tail" && ci.NumSubs == 1 {
				return true
			}
		}
		return false
	})
	return ns, pub, tail, frames
}

func TestFloodIsRateCappedAndHeldUnderBudget(t *testing.T) {
	const budget, flood = 200 << 10, 20_000
	ns, pub, tail, frames := startTail(t, "flood.>", budget)

	pub.Publish("flood.small", []byte("s"))
	pub.Publish("flood.big", bytes.Repeat([]byte("b"), budget+1))
	var rows []api.TailRow
	for len(rows) < 2 {
		rows = append(rows, (<-frames).Rows...)
	}
	if _, ok := tail.Message(0); !ok || rows[1].Subject != "flood.big" || rows[1].Held {
		t.Fatalf("rows %+v; want the oversized message kept as a row without its payload, and the one before it still held", rows)
	}

	payload := bytes.Repeat([]byte("x"), 1024)
	for range flood {
		pub.Publish("flood.x", payload)
	}
	pub.Flush()

	var last api.Tail
	for deadline := time.After(10 * time.Second); last.Received < flood+2; {
		select {
		case last = <-frames:
			rows = append(rows, last.Rows...)
		case <-deadline:
			t.Fatalf("received %d of %d", last.Received, flood+2)
		}
	}

	if last.RateDrops == 0 || last.RateDrops+last.PendingDrops+uint64(len(rows)) != flood+2 {
		t.Fatalf("rate drops %d, pending drops %d, rows %d; want rate-cap drops and every message counted once", last.RateDrops, last.PendingDrops, len(rows))
	}
	tail.mu.Lock()
	held := 0
	for i := range tail.rows {
		held += len(tail.rows[i].data)
	}
	tail.mu.Unlock()
	if held > budget || held != tail.held {
		t.Fatalf("held %d bytes (counted %d), budget %d", held, tail.held, budget)
	}
	if last.HeldFrom == 0 {
		t.Fatal("no payload was dropped, though the kept rows are over budget")
	}
	if _, ok := tail.Message(last.HeldFrom - 1); ok {
		t.Fatal("a row before HeldFrom still opens")
	}
	newest := rows[len(rows)-1]
	if m, ok := tail.Message(newest.ID); !ok || m.Payload == nil || *m.Payload != string(payload) || m.Kind != api.MsgKindText {
		t.Fatalf("newest row opens as %+v, %v", m, ok)
	}

	c, _ := ns.Connz(&server.ConnzOptions{})
	for _, ci := range c.Conns {
		if ci.Name == "Natter live tail" {
			ns.DisconnectClientByID(ci.Cid)
		}
	}
	for deadline := time.After(10 * time.Second); last.Disconnects == 0; {
		select {
		case last = <-frames:
		case <-deadline:
			t.Fatal("a server disconnect was not reported")
		}
	}
}

func TestBadFilterSaysWhy(t *testing.T) {
	ns, err := natstest.Start(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(ns.Shutdown)
	root := t.TempDir()
	natstest.WriteContext(root, "app", map[string]string{"url": ns.ClientURL(), "user": "app", "password": "app"})
	m := contexts.New(root, vault.Open(t.TempDir()))
	t.Cleanup(m.Close)
	m.Activate(t.Context(), api.Ref{Source: api.SourceCLI, Name: "app"})

	tail := NewTail("orders.>.x", m)
	tail.follow(t.Context())
	if p := tail.f.Problem; p == "" || tail.conn.nc != nil {
		t.Fatalf("problem %q; want an invalid filter refused before it connects", p)
	}
}

func TestRingWrapKeepsItsByteCount(t *testing.T) {
	tail := NewTail("x", nil)
	tail.limit = rate.NewLimiter(rate.Inf, 0)
	for range tailRows + 2_000 {
		tail.add(&nats.Msg{Subject: "x", Data: make([]byte, 100)})
	}
	if tail.held != tailRows*100 || tail.heldFrom != 2_000 {
		t.Fatalf("held %d bytes from row %d; want %d from 2000", tail.held, tail.heldFrom, tailRows*100)
	}
}
