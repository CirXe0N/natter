package server_test

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/CirXe0N/natter/internal/api"
	"github.com/CirXe0N/natter/internal/contexts"
	"github.com/CirXe0N/natter/internal/natstest"
	"github.com/CirXe0N/natter/internal/server"
)

func TestContextsAPI(t *testing.T) {
	ns, err := natstest.Start(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(ns.Shutdown)
	root := t.TempDir()
	if err := natstest.WriteContext(root, "app", map[string]string{"url": ns.ClientURL(), "user": "app", "password": "app"}); err != nil {
		t.Fatal(err)
	}
	m := contexts.New(root)
	t.Cleanup(m.Close)
	h := server.New(server.Config{Token: token, Port: port, UI: ui, Contexts: m})
	c := launch(t, h)
	call := func(method, target, body string) (int, string) {
		w := do(h, method, target, func(r *http.Request) {
			r.AddCookie(c)
			if body != "" {
				r.Body = io.NopCloser(strings.NewReader(body))
			}
		})
		return w.Code, w.Body.String()
	}

	code, body := call("GET", "/api/contexts", "")
	var list []api.Context
	if code != http.StatusOK || json.Unmarshal([]byte(body), &list) != nil || len(list) != 1 || list[0].Secret != api.SecretStoragePlaintext {
		t.Fatalf("GET /api/contexts: %d %s", code, body)
	}

	if code, body := call("GET", "/api/contexts/active", ""); code != http.StatusOK || !strings.Contains(body, `"status":"none"`) {
		t.Fatalf("active before any pick: %d %s", code, body)
	}

	code, body = call("PUT", "/api/contexts/active", `{"source":"cli","name":"app"}`)
	var active api.Active
	if code != http.StatusOK || json.Unmarshal([]byte(body), &active) != nil || active.Status != api.ConnStatusConnected || !active.Capabilities.JetStream {
		t.Fatalf("PUT /api/contexts/active: %d %s", code, body)
	}

	for _, tc := range []struct {
		method, target, body string
		want                 int
	}{
		{"PUT", "/api/contexts/active", `{"source":"cli","name":"missing"}`, http.StatusNotFound},
		{"PUT", "/api/contexts/active", `{"source":"vault","name":"app"}`, http.StatusNotFound},
		{"PUT", "/api/contexts/active", `not json`, http.StatusBadRequest},
		{"PUT", "/api/contexts/cli/app/settings", `{"monitoringUrl":"ftp://x"}`, http.StatusBadRequest},
		{"PUT", "/api/contexts/cli/app/settings", `{"monitoringUrl":"http://` + ns.MonitorAddr().String() + `"}`, http.StatusOK},
	} {
		if code, body := call(tc.method, tc.target, tc.body); code != tc.want {
			t.Errorf("%s %s %s: %d %s, want %d", tc.method, tc.target, tc.body, code, body, tc.want)
		}
	}
	if !m.Active().Caps.Monitoring {
		t.Error("saving the Monitoring URL of the active Context did not detect it")
	}
}
