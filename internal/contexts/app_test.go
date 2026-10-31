package contexts

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/CirXe0N/natter/internal/api"
	"github.com/CirXe0N/natter/internal/vault"
)

func newVaulted(user string) api.NewContext {
	return api.NewContext{Name: "vaulted", User: user, SecretKind: api.SecretKindPassword, Secret: "app", Description: "in the Vault"}
}

func TestAppContextWithAVaultSecretSurvivesARestart(t *testing.T) {
	ns, root, m := setup(t)
	if err := m.Vault().Create("passphrase"); err != nil {
		t.Fatal(err)
	}
	n := newVaulted("app")
	n.URLs = ns.ClientURL()
	c, err := m.Create(t.Context(), n)
	if err != nil {
		t.Fatal(err)
	}
	want := api.Context{Ref: api.Ref{Source: api.SourceApp, Name: "vaulted"}, Description: "in the Vault", URLs: ns.ClientURL(), User: "app", Secret: api.SecretStorageVault, Mode: api.ModeStatic}
	if c != want {
		t.Fatalf("created %+v", c)
	}

	file, err := os.ReadFile(filepath.Join(root, "natter", "nats", "context", "vaulted.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(file), `"password": "natter-vault://`) {
		t.Fatalf("the Context file holds no Vault reference:\n%s", file)
	}
	if _, err := os.Stat(filepath.Join(root, "nats", "context", "vaulted.json")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("an app Context was written to the natscli directory")
	}

	if err := m.Activate(t.Context(), c.Ref); err != nil {
		t.Fatal(err)
	}
	if a := m.Active(); a.Status != api.ConnStatusConnected || a.Caps.Account != "APP" {
		t.Fatalf("connect: %v %v %+v", a.Status, a.Err, a.Caps)
	}
	m.Close()

	restarted := New(root, vault.Open(filepath.Join(root, "natter")))
	t.Cleanup(restarted.Close)
	start := time.Now()
	if err := restarted.Restore(t.Context()); err != nil {
		t.Fatal(err)
	}
	a := restarted.Active()
	if a.Status != api.ConnStatusLocked || !errors.Is(a.Err, vault.ErrLocked) || a.NC != nil {
		t.Fatalf("restore with a locked Vault: %v %v", a.Status, a.Err)
	}
	if d := time.Since(start); d > time.Second {
		t.Fatalf("a locked connect took %v", d)
	}

	if err := restarted.Vault().UnlockPassphrase("passphrase"); err != nil {
		t.Fatal(err)
	}
	if err := restarted.Activate(t.Context(), c.Ref); err != nil {
		t.Fatal(err)
	}
	if a := restarted.Active(); a.Status != api.ConnStatusConnected {
		t.Fatalf("after unlock: %v %v", a.Status, a.Err)
	}
	list, err := restarted.List(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if !containsRef(list, c.Ref) {
		t.Fatalf("List lacks %v: %+v", c.Ref, list)
	}
}

func containsRef(list []api.Context, r api.Ref) bool {
	for _, c := range list {
		if c.Ref == r {
			return true
		}
	}
	return false
}

func TestCreateRejects(t *testing.T) {
	_, root, m := setup(t)
	locked := newVaulted("app")
	if _, err := m.Create(t.Context(), locked); !errors.Is(err, vault.ErrLocked) {
		t.Fatalf("locked Vault: %v", err)
	}
	if err := m.Vault().Create("passphrase"); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Create(t.Context(), api.NewContext{Name: "plain", URLs: "nats://127.0.0.1:4222"}); err != nil {
		t.Fatal(err)
	}
	for name, n := range map[string]api.NewContext{
		"duplicate":           {Name: "plain"},
		"bad name":            {Name: "a/b"},
		"password no user":    newVaulted(""),
		"creds with a user":   {Name: "c", User: "app", SecretKind: api.SecretKindCreds, Secret: "x"},
		"unknown secret kind": {Name: "k", SecretKind: "seed", Secret: "x"},
		"kind without secret": {Name: "e", SecretKind: api.SecretKindToken},
	} {
		if _, err := m.Create(t.Context(), n); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: %v", name, err)
		}
	}
	entries, err := os.ReadDir(filepath.Join(root, "natter", "nats", "context"))
	if err != nil || len(entries) != 1 {
		t.Fatalf("Context files: %v %v", entries, err)
	}
}
