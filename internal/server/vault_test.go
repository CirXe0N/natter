package server_test

import (
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"testing"

	"github.com/zalando/go-keyring"

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

// mapKeyring is an OS keyring that always answers.
type mapKeyring map[string]string

func (k mapKeyring) Set(_, user, secret string) error { k[user] = secret; return nil }
func (k mapKeyring) Get(_, user string) (string, error) {
	if s, ok := k[user]; ok {
		return s, nil
	}
	return "", keyring.ErrNotFound
}
func (k mapKeyring) Delete(_, user string) error { delete(k, user); return nil }

// With the key in the OS keyring, a restart reconnects a Context whose secret
// is in the Vault with no passphrase. The key moves under Read-only mode,
// because only local storage changes.
func TestKeyringAPI(t *testing.T) {
	ns, err := natstest.Start(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(ns.Shutdown)
	root, kr := t.TempDir(), mapKeyring{}
	start := func(k vault.Keyring) func(method, target, body string) (int, string) {
		v := vault.Open(filepath.Join(root, "natter"))
		if k != nil {
			if err := v.AttachKeyring(t.Context(), k); err != nil {
				t.Fatal(err)
			}
		}
		m := contexts.New(root, v)
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
	type step struct {
		method, target, body string
		want                 int
		in                   string
	}
	steps := func(name string, call func(method, target, body string) (int, string), steps []step) {
		for _, tc := range steps {
			if code, body := call(tc.method, tc.target, tc.body); code != tc.want || !strings.Contains(body, tc.in) {
				t.Fatalf("%s, %s %s %s: %d %s", name, tc.method, tc.target, tc.body, code, body)
			}
		}
	}

	steps("no keyring", start(nil), []step{
		{"GET", "/api/vault", "", 200, `"keyring":"unavailable"`},
		{"POST", "/api/vault", `{"passphrase":"open sesame"}`, 200, `"keyring":"unavailable"`},
		{"POST", "/api/vault/keyring", "", http.StatusConflict, "no OS keyring"},
		{"POST", "/api/contexts", `{"name":"vaulted","urls":"` + ns.ClientURL() + `","user":"app","secretKind":"password","secret":"app"}`, 200, `"secret":"vault"`},
		{"PUT", "/api/contexts/active", `{"source":"app","name":"vaulted"}`, 200, `"status":"connected"`},
		{"PUT", "/api/contexts/app/vaulted/settings", `{"readOnly":true}`, 200, ""},
	})
	steps("keyring, locked", start(kr), []step{
		{"GET", "/api/vault", "", 200, `"state":"locked","hasPassphrase":true,"keyring":"off"`},
		{"POST", "/api/vault/keyring", "", http.StatusLocked, "locked"},
		{"POST", "/api/vault/unlock", `{"passphrase":"open sesame"}`, 200, `"keyring":"off"`},
		{"POST", "/api/vault/keyring", "", 200, `"keyring":"on"`},
	})
	steps("keyring, restarted", start(kr), []step{
		{"GET", "/api/vault", "", 200, `"state":"unlocked","hasPassphrase":true,"keyring":"on"`},
		{"GET", "/api/contexts/active", "", 200, `"status":"connected"`},
		{"DELETE", "/api/vault/keyring", "", 200, `"keyring":"off"`},
	})
	steps("keyring emptied, restarted", start(kr), []step{
		{"GET", "/api/vault", "", 200, `"state":"locked","hasPassphrase":true,"keyring":"off"`},
	})
	if len(kr) != 0 {
		t.Fatalf("keyring items left: %v", kr)
	}
}
