package server_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/nats-io/nats.go"

	"github.com/CirXe0N/natter/internal/api"
	"github.com/CirXe0N/natter/internal/contexts"
	"github.com/CirXe0N/natter/internal/natstest"
	"github.com/CirXe0N/natter/internal/server"
	"github.com/CirXe0N/natter/internal/vault"
)

func TestLiveTailUnderReadOnly(t *testing.T) {
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
	ref := api.Ref{Source: api.SourceCLI, Name: "app"}
	if err := m.SetSettings(t.Context(), ref, api.Settings{ReadOnly: true}); err != nil {
		t.Fatal(err)
	}
	if err := m.Activate(t.Context(), ref); err != nil {
		t.Fatal(err)
	}
	h := server.New(server.Config{Token: token, Port: port, UI: ui, Contexts: m})
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	session := launch(t, h)
	hdr := http.Header{"Cookie": {session.String()}}
	c, _, err := websocket.Dial(t.Context(), "ws://"+srv.Listener.Addr().String()+"/ws", &websocket.DialOptions{HTTPHeader: hdr})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.CloseNow() })
	if err := wsjson.Write(t.Context(), c, api.ClientFrame{Op: api.ClientOpSub, Topic: "tail:demo.>"}); err != nil {
		t.Fatal(err)
	}

	pub, err := nats.Connect(ns.ClientURL(), nats.UserInfo("app", "app"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pub.Close)
	var row api.TailRow
	for deadline := time.Now().Add(10 * time.Second); row.Subject == ""; {
		if time.Now().After(deadline) {
			t.Fatal("no row arrived")
		}
		pub.Publish("demo.one", []byte(`{"n":1}`))
		var f api.ServerFrame
		if err := wsjson.Read(t.Context(), c, &f); err != nil {
			t.Fatal(err)
		}
		if f.Topic != "tail:demo.>" || f.Tail == nil || f.Tail.Problem != "" {
			t.Fatalf("frame %+v", f)
		}
		if len(f.Tail.Rows) > 0 {
			row = f.Tail.Rows[0]
		}
	}

	get := func(id uint64) *httptest.ResponseRecorder {
		return do(h, "GET", fmt.Sprintf("/api/tail/message?filter=%s&id=%d", url.QueryEscape("demo.>"), id), withCookie(session))
	}
	w := get(row.ID)
	var msg api.TailMessage
	if err := json.Unmarshal(w.Body.Bytes(), &msg); w.Code != 200 || err != nil || msg.Payload == nil || *msg.Payload != `{"n":1}` || msg.Kind != api.MsgKindJSON {
		t.Fatalf("open: %d %s", w.Code, w.Body)
	}
	if w := get(1 << 40); w.Code != http.StatusGone {
		t.Fatalf("open an unknown row: %d, want 410", w.Code)
	}
}
