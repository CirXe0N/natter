package contexts

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/zalando/go-keyring"

	"github.com/CirXe0N/natter/internal/api"
	"github.com/CirXe0N/natter/internal/vault"
)

func TestUpdateKeepsUneditedFieldsAndReplacesTheVaultSecret(t *testing.T) {
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
	path := filepath.Join(root, "natter", "nats", "context", "vaulted.json")
	before, _ := os.ReadFile(path)
	oldRef := vaultRef(t, before)
	// A field Natter does not edit must survive.
	if err := os.WriteFile(path, []byte(strings.Replace(string(before), `"jetstream_domain": ""`, `"jetstream_domain": "hub"`, 1)), 0o600); err != nil {
		t.Fatal(err)
	}

	// Keeping the secret changes only the edited fields.
	got, err := m.Update(t.Context(), c.Ref, api.ContextUpdate{Description: "", URLs: ns.ClientURL(), User: "app", KeepSecret: true})
	if err != nil {
		t.Fatal(err)
	}
	if got.Description != "" || got.SecretKind != api.SecretKindPassword || got.Secret != api.SecretStorageVault {
		t.Fatalf("kept: %+v", got)
	}
	file, _ := os.ReadFile(path)
	if vaultRef(t, file) != oldRef || !strings.Contains(string(file), `"jetstream_domain": "hub"`) {
		t.Fatalf("the file after keeping the secret:\n%s", file)
	}

	// Replacing it with a reference deletes the old Vault entry.
	t.Setenv("NATTER_EDIT_TOKEN", "x")
	got, err = m.Update(t.Context(), c.Ref, api.ContextUpdate{URLs: ns.ClientURL(), SecretKind: api.SecretKindToken, SecretRef: "env://NATTER_EDIT_TOKEN"})
	if err != nil {
		t.Fatal(err)
	}
	if got.SecretKind != api.SecretKindToken || got.Secret != api.SecretStorageEnv || got.User != "" {
		t.Fatalf("replaced: %+v", got)
	}
	file, _ = os.ReadFile(path)
	if strings.Contains(string(file), "natter-vault://") || !strings.Contains(string(file), `"password": ""`) {
		t.Fatalf("the old secret is still in the file:\n%s", file)
	}
	if _, err := m.Vault().Resolve(t.Context(), oldRef); err == nil {
		t.Fatal("the replaced secret is still in the Vault")
	}
}

func TestUpdateRejects(t *testing.T) {
	ns, _, m := setup(t)
	app := api.Ref{Source: api.SourceCLI, Name: "app"}
	for name, u := range map[string]api.ContextUpdate{
		"a password with no user":      {URLs: ns.ClientURL(), KeepSecret: true},
		"a Vault secret in a CLI file": {URLs: ns.ClientURL(), User: "app", SecretKind: api.SecretKindPassword, Secret: "app"},
		"a broken reference":           {URLs: ns.ClientURL(), User: "app", SecretKind: api.SecretKindPassword, SecretRef: "vault://x"},
	} {
		if _, err := m.Update(t.Context(), app, u); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: %v", name, err)
		}
	}
	if _, err := m.Update(t.Context(), api.Ref{Source: api.SourceApp, Name: "missing"}, api.ContextUpdate{KeepSecret: true}); !errors.Is(err, ErrUnknown) {
		t.Errorf("an unknown Context: %v", err)
	}
}

func TestRemoveAnAppContextDeletesItsVaultSecret(t *testing.T) {
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
	path := filepath.Join(root, "natter", "nats", "context", "vaulted.json")
	file, _ := os.ReadFile(path)
	ref := vaultRef(t, file)
	if err := m.SetSettings(t.Context(), c.Ref, api.Settings{ReadOnly: true}); err != nil {
		t.Fatal(err)
	}

	// A locked Vault would orphan the secret, so the remove waits for it.
	locked := New(root, vault.Open(filepath.Join(root, "natter")))
	t.Cleanup(locked.Close)
	if err := locked.Remove(t.Context(), c.Ref); !errors.Is(err, ErrInvalid) {
		t.Fatalf("remove with the Vault locked: %v", err)
	}

	if err := m.Remove(t.Context(), c.Ref); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("the file is still there")
	}
	if _, err := m.Vault().Resolve(t.Context(), ref); err == nil {
		t.Fatal("the secret is still in the Vault")
	}
	// Re-creating the name starts with no Settings.
	if c, err = m.Create(t.Context(), api.NewContext{Name: "vaulted", URLs: ns.ClientURL()}); err != nil || c.ReadOnly {
		t.Fatalf("re-create: %+v %v", c, err)
	}
}

func vaultRef(t *testing.T, file []byte) string {
	t.Helper()
	i := strings.Index(string(file), "natter-vault://")
	if i < 0 {
		t.Fatalf("no Vault reference in:\n%s", file)
	}
	return string(file[i : i+strings.IndexByte(string(file[i:]), '"')])
}

type mockKeyring struct{}

func (mockKeyring) Set(s, u, v string) error        { return keyring.Set(s, u, v) }
func (mockKeyring) Get(s, u string) (string, error) { return keyring.Get(s, u) }
func (mockKeyring) Delete(s, u string) error        { return keyring.Delete(s, u) }

func TestTheFirstVaultSecretCreatesTheVaultInTheKeyring(t *testing.T) {
	ns, root, m := setup(t)
	n := newVaulted("app")
	n.URLs = ns.ClientURL()
	if _, err := m.Create(t.Context(), n); !errors.Is(err, vault.ErrLocked) {
		t.Fatalf("with no keyring and no Vault: %v", err)
	}

	keyring.MockInit()
	if err := m.Vault().AttachKeyring(t.Context(), mockKeyring{}); err != nil {
		t.Fatal(err)
	}
	c, err := m.Create(t.Context(), n)
	if err != nil {
		t.Fatal(err)
	}
	if got := m.Vault().Status(); got != (api.Vault{State: api.VaultStateUnlocked, Keyring: api.KeyringOn}) {
		t.Fatalf("the Vault: %+v", got)
	}

	// After a restart the keyring unlocks it, and the Context connects.
	restarted := New(root, vault.Open(filepath.Join(root, "natter")))
	t.Cleanup(restarted.Close)
	if err := restarted.Vault().AttachKeyring(t.Context(), mockKeyring{}); err != nil {
		t.Fatal(err)
	}
	if err := restarted.Activate(t.Context(), c.Ref); err != nil {
		t.Fatal(err)
	}
	if a := restarted.Active(); a.Status != api.ConnStatusConnected {
		t.Fatalf("connect: %v %v", a.Status, a.Err)
	}
}
