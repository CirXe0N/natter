package server_test

import (
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"testing"

	"github.com/CirXe0N/natter/internal/contexts"
	"github.com/CirXe0N/natter/internal/natstest"
	"github.com/CirXe0N/natter/internal/server"
	"github.com/CirXe0N/natter/internal/vault"
)

// A Context whose secret is in a locked Vault asks for the passphrase, and
// unlocking reconnects it.
func TestVaultAPI(t *testing.T) {
	ns, err := natstest.Start(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(ns.Shutdown)
	root := t.TempDir()
	start := func() func(method, target, body string) (int, string) {
		m := contexts.New(root, vault.Open(filepath.Join(root, "natter")))
		t.Cleanup(m.Close)
		h := server.New(server.Config{Token: token, Port: port, UI: ui, Contexts: m})
		c := launch(t, h)
		if err := m.Restore(t.Context()); err != nil {
			t.Fatal(err)
		}
		return func(method, target, body string) (int, string) {
			w := do(h, method, target, func(r *http.Request) {
				r.AddCookie(c)
				r.Body = io.NopCloser(strings.NewReader(body))
			})
			return w.Code, w.Body.String()
		}
	}
	newContext := `{"name":"vaulted","urls":"` + ns.ClientURL() + `","user":"app","secretKind":"password","secret":"app"}`

	call := start()
	for _, tc := range []struct {
		method, target, body string
		want                 int
		in                   string
	}{
		{"GET", "/api/vault", "", 200, `"state":"none"`},
		{"POST", "/api/contexts", newContext, http.StatusLocked, "locked"},
		{"POST", "/api/vault", `{"passphrase":""}`, 400, "empty"},
		{"POST", "/api/vault", `{"passphrase":"open sesame"}`, 200, `"state":"unlocked","hasPassphrase":true`},
		{"POST", "/api/vault", `{"passphrase":"again"}`, http.StatusConflict, "already exists"},
		{"POST", "/api/contexts", newContext, 200, `"secret":"vault"`},
		{"POST", "/api/contexts", newContext, 400, "already exists"},
		{"PUT", "/api/contexts/active", `{"source":"app","name":"vaulted"}`, 200, `"status":"connected"`},
	} {
		if code, body := call(tc.method, tc.target, tc.body); code != tc.want || !strings.Contains(body, tc.in) {
			t.Fatalf("%s %s %s: %d %s", tc.method, tc.target, tc.body, code, body)
		}
	}

	call = start() // a restart: the Vault is locked and the Context waits for it
	for _, tc := range []struct {
		method, target, body string
		want                 int
		in                   string
	}{
		{"GET", "/api/vault", "", 200, `"state":"locked","hasPassphrase":true`},
		{"GET", "/api/contexts/active", "", 200, `"status":"locked"`},
		{"POST", "/api/vault/unlock", `{"passphrase":"wrong"}`, 400, "wrong passphrase"},
		{"POST", "/api/vault/unlock", `{"passphrase":"open sesame"}`, 200, `"state":"unlocked"`},
		{"GET", "/api/contexts/active", "", 200, `"status":"connected"`},
	} {
		if code, body := call(tc.method, tc.target, tc.body); code != tc.want || !strings.Contains(body, tc.in) {
			t.Fatalf("after restart, %s %s %s: %d %s", tc.method, tc.target, tc.body, code, body)
		}
	}
}
