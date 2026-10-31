package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/CirXe0N/natter/internal/api"
	"github.com/CirXe0N/natter/internal/contexts"
	"github.com/CirXe0N/natter/internal/natstest"
	"github.com/CirXe0N/natter/internal/vault"
)

// No real mutating route exists yet, so the test registers one the way a feature file would.
func TestReadOnlyRefusesMutatingRoutes(t *testing.T) {
	routes = append(routes, route{pattern: "POST /api/test/mutate", handle: func(_ *server, w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) }})
	t.Cleanup(func() { routes = routes[:len(routes)-1] })

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
	h := New(Config{Token: "tok", Port: 1, UI: fstest.MapFS{}, Contexts: m})

	var session *http.Cookie
	call := func(method, target, body string) int {
		r := httptest.NewRequest(method, target, strings.NewReader(body))
		r.Host = "localhost"
		if session != nil {
			r.AddCookie(session)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if c := w.Result().Cookies(); len(c) > 0 {
			session = c[0]
		}
		return w.Code
	}
	want := func(got, want int, what string) {
		t.Helper()
		if got != want {
			t.Errorf("%s: %d, want %d", what, got, want)
		}
	}
	call("GET", "/launch?token=tok", "")
	ref := api.Ref{Source: api.SourceCLI, Name: "app"}
	want(call("PUT", "/api/contexts/active", `{"source":"cli","name":"app"}`), 200, "connect")

	want(call("POST", "/api/test/mutate", ""), 204, "mutate without Read-only")

	want(call("PUT", "/api/contexts/cli/app/settings", `{"readOnly":true}`), 200, "lock")
	want(call("POST", "/api/test/mutate", ""), 403, "mutate under Read-only")
	want(call("GET", "/api/contexts", ""), 200, "browse under Read-only")
	want(call("PUT", "/api/contexts/active", `{"source":"cli","name":"app"}`), 200, "switch under Read-only")
	if !m.Active().Context.ReadOnly {
		t.Fatalf("%v lost its lock", ref)
	}
	want(call("POST", "/api/vault", `{"passphrase":"pw"}`), 200, "create the Vault under Read-only")
	want(call("POST", "/api/vault/unlock", `{"passphrase":"pw"}`), 200, "unlock the Vault under Read-only")
	want(call("POST", "/api/contexts", `{"name":"local","urls":"nats://127.0.0.1:1"}`), 200, "create a Context under Read-only")
	want(call("POST", "/api/contexts/cli/app/move-to-vault", `{}`), 200, "move into the Vault under Read-only")
	want(call("POST", "/api/contexts/cli/app/remove", `{"confirm":true}`), 403, "edit a CLI file under Read-only")

	want(call("PUT", "/api/contexts/cli/app/settings", `{}`), 200, "unlock while locked")
	want(call("POST", "/api/test/mutate", ""), 204, "mutate after unlock")
	want(call("POST", "/api/contexts/cli/app/remove", `{}`), 400, "remove without confirm")
}
