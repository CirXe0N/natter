package server_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"

	"github.com/CirXe0N/natter/internal/api"
	"github.com/CirXe0N/natter/internal/contexts"
	"github.com/CirXe0N/natter/internal/natstest"
	"github.com/CirXe0N/natter/internal/server"
	"github.com/CirXe0N/natter/internal/vault"
)

func TestOpenMessage(t *testing.T) {
	ns, err := natstest.Start(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(ns.Shutdown)
	nc, err := nats.Connect(ns.ClientURL(), nats.UserInfo("app", "app"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(nc.Close)
	js, _ := jetstream.New(nc)
	ctx := context.Background()
	orders, err := js.CreateStream(ctx, jetstream.StreamConfig{Name: "ORDERS", Subjects: []string{"orders.>"}, AllowDirect: true})
	if err != nil {
		t.Fatal(err)
	}
	big := make([]byte, 200_000)
	for i := range big {
		big[i] = byte(i)
	}
	m := nats.NewMsg("orders.eu")
	m.Header.Add("A", "1")
	m.Header.Add("A", "2")
	m.Data = big
	if _, err := js.PublishMsg(ctx, m); err != nil {
		t.Fatal(err)
	}
	if _, err := js.Publish(ctx, "orders.us", []byte(`{"n":2}`)); err != nil {
		t.Fatal(err)
	}

	root := t.TempDir()
	if err := natstest.WriteContext(root, "app", map[string]string{"url": ns.ClientURL(), "user": "app", "password": "app"}); err != nil {
		t.Fatal(err)
	}
	cm := contexts.New(root, vault.Open(t.TempDir()))
	t.Cleanup(cm.Close)
	h := server.New(server.Config{Token: token, Port: port, UI: ui, Contexts: cm})
	c := launch(t, h)
	send := func(method, path, body string, header http.Header, want int) *http.Response {
		t.Helper()
		w := do(h, method, path, func(r *http.Request) {
			r.AddCookie(c)
			r.Body = io.NopCloser(strings.NewReader(body))
			for k, v := range header {
				r.Header[k] = v
			}
		})
		if w.Code != want {
			t.Fatalf("%s %s: %d %s (want %d)", method, path, w.Code, w.Body, want)
		}
		return w.Result()
	}
	read := func(r *http.Response) []byte { b, _ := io.ReadAll(r.Body); return b }
	// counted waits for the subscriptions below, which count requests on their own goroutine.
	counted := func(what string, n *atomic.Int32, want int32) {
		t.Helper()
		for deadline := time.Now().Add(2 * time.Second); n.Load() != want; time.Sleep(10 * time.Millisecond) {
			if time.Now().After(deadline) {
				t.Errorf("%s: %d, want %d", what, n.Load(), want)
				return
			}
		}
	}
	send("PUT", "/api/contexts/active", `{"source":"cli","name":"app"}`, nil, 200)

	var direct, leader atomic.Int32
	for subj, n := range map[string]*atomic.Int32{"$JS.API.DIRECT.GET.ORDERS": &direct, "$JS.API.STREAM.MSG.GET.ORDERS": &leader} {
		if _, err := nc.Subscribe(subj, func(*nats.Msg) { n.Add(1) }); err != nil {
			t.Fatal(err)
		}
	}
	nc.Flush()

	var msg api.Msg
	if err := json.Unmarshal(read(send("GET", "/api/streams/ORDERS/messages/1", "", nil, 200)), &msg); err != nil {
		t.Fatal(err)
	}
	if msg.Seq != 1 || msg.Subject != "orders.eu" || msg.Size != len(big) || len(msg.Headers) != 1 || strings.Join(msg.Headers["A"], ",") != "1,2" || msg.Time.IsZero() {
		t.Errorf("message: %+v", msg)
	}

	// The 64 KB preview is a Range request.
	r := send("GET", "/api/streams/ORDERS/messages/1/payload", "", http.Header{"Range": {"bytes=0-65535"}}, http.StatusPartialContent)
	if got := read(r); !bytes.Equal(got, big[:65536]) {
		t.Errorf("preview is %d bytes", len(got))
	}
	if cr := r.Header.Get("Content-Range"); cr != "bytes 0-65535/200000" {
		t.Errorf("Content-Range %q", cr)
	}
	if r.Header.Get("Content-Type") != "application/octet-stream" || r.Header.Get("X-Content-Type-Options") != "nosniff" || r.Header.Get("Content-Disposition") != "" {
		t.Errorf("preview headers %v", r.Header)
	}
	r = send("GET", "/api/streams/ORDERS/messages/1/payload?download", "", nil, 200)
	if got := read(r); !bytes.Equal(got, big) {
		t.Errorf("download is %d bytes", len(got))
	}
	if cd := r.Header.Get("Content-Disposition"); cd != `attachment; filename=ORDERS-1.bin` {
		t.Errorf("Content-Disposition %q", cd)
	}
	counted("Direct Gets", &direct, 3)
	counted("leader gets without a lagging follower", &leader, 0)

	// A follower that has not caught up answers a Direct Get with 404. The
	// account maps Direct Gets to a responder that plays that follower.
	acc, err := ns.LookupAccount("APP")
	if err != nil {
		t.Fatal(err)
	}
	var lagging atomic.Int32
	if _, err := nc.Subscribe("lagging.direct", func(m *nats.Msg) {
		lagging.Add(1)
		_ = m.RespondMsg(&nats.Msg{Header: nats.Header{"Status": {"404"}, "Description": {"Message Not Found"}}})
	}); err != nil {
		t.Fatal(err)
	}
	if err := acc.AddMapping("$JS.API.DIRECT.GET.ORDERS", "lagging.direct"); err != nil {
		t.Fatal(err)
	}
	nc.Flush()
	leader.Store(0)
	if got := read(send("GET", "/api/streams/ORDERS/messages/1/payload", "", nil, 200)); !bytes.Equal(got, big) {
		t.Errorf("after the leader retry the payload is %d bytes", len(got))
	}
	counted("lagging follower asked", &lagging, 1)
	counted("leader asked once", &leader, 1)
	send("GET", "/api/streams/ORDERS/messages/9/payload", "", nil, 404)
	counted("a missing message: lagging follower asked", &lagging, 2)
	counted("a missing message: leader asked once more", &leader, 2)
	acc.RemoveMapping("$JS.API.DIRECT.GET.ORDERS")

	send("GET", "/api/streams/ORDERS/messages/9", "", nil, 404)
	send("GET", "/api/streams/NOPE/messages/1/payload", "", nil, 404)
	send("GET", "/api/streams/ORDERS/messages/x/payload", "", nil, 400)

	// Delete, with and without erasing.
	send("DELETE", "/api/streams/ORDERS/messages/2", `{"erase":true}`, nil, 200)
	send("GET", "/api/streams/ORDERS/messages/2", "", nil, 404)
	send("DELETE", "/api/streams/ORDERS/messages/2", `{}`, nil, 404)
	send("PUT", "/api/contexts/cli/app/settings", `{"readOnly":true}`, nil, 200)
	send("GET", "/api/streams/ORDERS/messages/1/payload", "", nil, 200)
	send("DELETE", "/api/streams/ORDERS/messages/1", `{}`, nil, 403)
	send("PUT", "/api/contexts/cli/app/settings", `{}`, nil, 200)
	send("DELETE", "/api/streams/ORDERS/messages/1", `{}`, nil, 200)
	if info, _ := orders.Info(ctx); info.State.Msgs != 0 {
		t.Errorf("%d messages left", info.State.Msgs)
	}
}
