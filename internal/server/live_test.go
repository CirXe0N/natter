package server_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	"github.com/CirXe0N/natter/internal/api"
	"github.com/CirXe0N/natter/internal/contexts"
	"github.com/CirXe0N/natter/internal/server"
	"github.com/CirXe0N/natter/internal/vault"
)

func TestLiveSocket(t *testing.T) {
	m := contexts.New(t.TempDir(), vault.Open(t.TempDir()))
	h := server.New(server.Config{Token: token, Port: port, UI: ui, Contexts: m, TrustedOrigins: []string{"http://localhost:5173"}})
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	url := "ws://" + srv.Listener.Addr().String() + "/ws"
	session := launch(t, h)

	dial := func(origin string, withSession bool) (*websocket.Conn, int) {
		hdr := http.Header{}
		if origin != "" {
			hdr.Set("Origin", origin)
		}
		if withSession {
			hdr.Set("Cookie", session.String())
		}
		c, resp, err := websocket.Dial(t.Context(), url, &websocket.DialOptions{HTTPHeader: hdr})
		if err != nil {
			return nil, resp.StatusCode
		}
		t.Cleanup(func() { c.CloseNow() })
		return c, resp.StatusCode
	}

	for _, tc := range []struct {
		name, origin string
		session      bool
		want         int
	}{
		{"no session", "", false, http.StatusUnauthorized},
		{"foreign Origin", "http://evil.example", true, http.StatusForbidden},
		{"Origin null", "null", true, http.StatusForbidden},
		{"another localhost port", "http://localhost:5174", true, http.StatusForbidden},
		{"trusted -dev Origin", "http://localhost:5173", true, http.StatusSwitchingProtocols},
		{"same origin", "http://" + srv.Listener.Addr().String(), true, http.StatusSwitchingProtocols},
	} {
		if _, got := dial(tc.origin, tc.session); got != tc.want {
			t.Errorf("%s: status %d, want %d", tc.name, got, tc.want)
		}
	}

	c, _ := dial("", true)
	c.SetReadLimit(1 << 20) // the first frame carries an hour of history
	if err := wsjson.Write(t.Context(), c, api.ClientFrame{Op: api.ClientOpSub, Topic: api.TopicOverview}); err != nil {
		t.Fatal(err)
	}
	var f api.ServerFrame
	if err := wsjson.Read(t.Context(), c, &f); err != nil {
		t.Fatal(err)
	}
	if f.Topic != api.TopicOverview || f.Overview == nil || f.Overview.Source != api.StatsSourceNone || !strings.Contains(f.Overview.Problem, "No Context is active") {
		t.Fatalf("frame %+v", f)
	}
}
