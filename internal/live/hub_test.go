package live

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	"github.com/CirXe0N/natter/internal/api"
)

// counter emits "n" frames of size bytes every interval and counts its runs.
type counter struct {
	interval time.Duration
	size     int
	runs     atomic.Int32
	stopped  atomic.Int32
}

func (p *counter) Run(ctx context.Context, emit func([]byte, bool)) {
	p.runs.Add(1)
	defer p.stopped.Add(1)
	for n := 1; ; n++ {
		frame := []byte(strconv.Itoa(n))
		if p.size > 0 {
			frame = bytes.Repeat([]byte("x"), p.size)
		}
		emit(frame, false)
		select {
		case <-ctx.Done():
			return
		case <-time.After(p.interval):
		}
	}
}

func (p *counter) Snapshot() []byte { return []byte("snapshot") }

func serve(t *testing.T, p *counter) (*Hub, string) {
	t.Helper()
	h := NewHub(map[api.Topic]func() Producer{"t": func() Producer { return p }})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { h.Serve(w, r, nil) }))
	t.Cleanup(srv.Close)
	return h, "ws://" + srv.Listener.Addr().String()
}

func dial(t *testing.T, url string) *websocket.Conn {
	t.Helper()
	c, _, err := websocket.Dial(t.Context(), url, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.CloseNow() })
	return c
}

func send(t *testing.T, c *websocket.Conn, op api.ClientOp, topic api.Topic) {
	t.Helper()
	if err := wsjson.Write(t.Context(), c, api.ClientFrame{Op: op, Topic: topic}); err != nil {
		t.Fatal(err)
	}
}

func read(t *testing.T, c *websocket.Conn, wait time.Duration) (string, error) {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), wait)
	defer cancel()
	_, b, err := c.Read(ctx)
	return string(b), err
}

func eventually(t *testing.T, what string, ok func() bool) {
	t.Helper()
	for deadline := time.Now().Add(10 * time.Second); !ok(); time.Sleep(10 * time.Millisecond) {
		if time.Now().After(deadline) {
			t.Fatal(what)
		}
	}
}

func TestSubscribeGetsSnapshotThenFramesUntilUnsubscribed(t *testing.T) {
	p := &counter{interval: 20 * time.Millisecond}
	_, url := serve(t, p)
	c := dial(t, url)

	send(t, c, api.ClientOpSub, "t")
	if got, err := read(t, c, 5*time.Second); err != nil || got != "snapshot" {
		t.Fatalf("first frame %q, %v; want the snapshot", got, err)
	}
	if got, err := read(t, c, 5*time.Second); err != nil || got == "snapshot" {
		t.Fatalf("second frame %q, %v; want a produced frame", got, err)
	}

	send(t, c, api.ClientOpUnsub, "t")
	ctx, cancel := context.WithTimeout(t.Context(), 300*time.Millisecond)
	defer cancel()
	n := 0
	for ; ; n++ {
		if _, _, err := c.Read(ctx); err != nil {
			break
		}
	}
	if n > 1 { // one frame may already have been on its way
		t.Fatalf("%d frames after unsubscribe", n)
	}
}

func TestUnknownTopicIsRefused(t *testing.T) {
	_, url := serve(t, &counter{interval: time.Second})
	c := dial(t, url)
	send(t, c, api.ClientOpSub, "nope")
	if got, err := read(t, c, 5*time.Second); err != nil || !strings.Contains(got, `"error":"unknown topic"`) {
		t.Fatalf("got %q, %v", got, err)
	}
}

func TestProducerOutlivesAReloadWithinTheGracePeriod(t *testing.T) {
	p := &counter{interval: 20 * time.Millisecond}
	h, url := serve(t, p)
	h.Grace = 500 * time.Millisecond

	first := dial(t, url)
	send(t, first, api.ClientOpSub, "t")
	read(t, first, 5*time.Second)
	first.Close(websocket.StatusNormalClosure, "reload")

	second := dial(t, url)
	send(t, second, api.ClientOpSub, "t")
	read(t, second, 5*time.Second)
	if p.runs.Load() != 1 || p.stopped.Load() != 0 {
		t.Fatalf("runs %d, stopped %d; want the first producer kept", p.runs.Load(), p.stopped.Load())
	}

	second.Close(websocket.StatusNormalClosure, "gone")
	eventually(t, "producer still running after the grace period", func() bool { return p.stopped.Load() == 1 })
}

func TestPendingFramesCollapseToTheLatestPerTopic(t *testing.T) {
	c := newClient()
	c.send("a", []byte("snap"), true)
	c.send("a", []byte("1"), false)
	c.send("a", []byte("2"), false)
	c.send("b", []byte("x"), false)
	got := c.take()
	if len(got) != 2 || string(got["a"].snapshot) != "snap" || string(got["a"].update) != "2" || string(got["b"].update) != "x" {
		t.Fatalf("pending a %v, b %v; want the snapshot kept and the latest update", got["a"], got["b"])
	}

	c.send("a", []byte("1"), false)
	c.send("a", []byte("snap2"), true)
	if got := c.take()["a"]; string(got.snapshot) != "snap2" || got.update != nil {
		t.Fatalf("pending %v; a snapshot supersedes earlier updates", got)
	}
}

func TestClientThatStopsReadingIsDisconnected(t *testing.T) {
	p := &counter{interval: time.Millisecond, size: 1 << 20}
	h, url := serve(t, p)
	h.WriteTimeout, h.Grace = 100*time.Millisecond, 10*time.Millisecond

	c := dial(t, url) // never reads, so the socket buffers fill and a write stalls
	send(t, c, api.ClientOpSub, "t")
	eventually(t, "stalled client is still subscribed", func() bool { return p.stopped.Load() == 1 })
}

func TestLossyTopicDropsOldestFramesAndSendsAGapMarker(t *testing.T) {
	c := newClient()
	for n := 1; n <= maxQueued+4; n++ {
		c.queue("tail:x", []byte(strconv.Itoa(n)))
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer conn.CloseNow()
		c.write(r.Context(), conn, time.Second)
	}))
	t.Cleanup(srv.Close)
	ws := dial(t, "ws://"+srv.Listener.Addr().String())

	var got []string
	for range maxQueued + 1 {
		f, err := read(t, ws, 5*time.Second)
		if err != nil {
			t.Fatal(err)
		}
		got = append(got, f)
	}
	if got[0] != `{"topic":"tail:x","gap":4}` || got[1] != "5" || got[maxQueued] != strconv.Itoa(maxQueued+4) {
		t.Fatalf("frames %q; want a gap of 4, then frames 5 to %d", got, maxQueued+4)
	}
}

// quiet is a Lossy producer that only has a snapshot.
type quiet struct{}

func (quiet) Run(ctx context.Context, _ func([]byte, bool)) { <-ctx.Done() }
func (quiet) Snapshot() []byte                              { return []byte("snapshot") }
func (quiet) Lossy()                                        {}

func TestFamilyTopicsGetOneProducerPerArgument(t *testing.T) {
	var args []string
	h := NewHub(nil)
	h.Families = map[api.Topic]func(string) Producer{"tail:": func(arg string) Producer {
		args = append(args, arg)
		return quiet{}
	}}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { h.Serve(w, r, nil) }))
	t.Cleanup(srv.Close)
	c := dial(t, "ws://"+srv.Listener.Addr().String())

	send(t, c, api.ClientOpSub, "tail:orders.>")
	if got, err := read(t, c, 5*time.Second); err != nil || got != "snapshot" {
		t.Fatalf("first frame %q, %v; want the snapshot", got, err)
	}
	send(t, c, api.ClientOpSub, "tail:orders.*")
	read(t, c, 5*time.Second)
	if _, ok := h.Producer("tail:orders.*").(quiet); !ok || len(args) != 2 || args[0] != "orders.>" {
		t.Fatalf("args %q; want one lossy producer per filter", args)
	}
	send(t, c, api.ClientOpSub, "nope:x")
	if got, _ := read(t, c, 5*time.Second); !strings.Contains(got, "unknown topic") {
		t.Fatalf("got %q; want an unknown key refused", got)
	}
}
