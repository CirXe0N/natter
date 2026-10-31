package vault

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/zalando/go-keyring"

	"github.com/CirXe0N/natter/internal/api"
)

func readFile(t *testing.T, path string) []byte {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func attach(t *testing.T, dir string) *Vault {
	t.Helper()
	v := Open(dir)
	if err := v.AttachKeyring(t.Context(), osKeyring{}); err != nil {
		t.Fatal(err)
	}
	return v
}

// go-keyring's in-memory provider stands in for the OS keyring. Each MockInit
// starts empty, and nothing in this package touches the real keyring.
func TestTheKeyringUnlocksTheVaultAtStartupAndMovingTheKeyLeavesVaultAgeAlone(t *testing.T) {
	keyring.MockInit()
	dir := t.TempDir()

	v := attach(t, dir)
	if got := v.Status(); got.State != api.VaultStateNone || got.Keyring != api.KeyringOff {
		t.Fatalf("fresh dir: %+v", got)
	}
	if err := v.Create("pass"); err != nil {
		t.Fatal(err)
	}
	ref := put(t, v, "s3cret-password")
	stored, err := keyring.Get(keyringService, v.keyringUser())
	if err != nil || !strings.HasPrefix(stored, "AGE-SECRET-KEY-PQ-1") || strings.Contains(stored, "s3cret") {
		t.Fatalf("the keyring item must be the Vault identity only: %v", err)
	}
	vaultAge, wrapper := readFile(t, filepath.Join(dir, "vault.age")), readFile(t, filepath.Join(dir, "vault.key.age"))

	restarted := attach(t, dir)
	if got := restarted.Status(); got != (api.Vault{State: api.VaultStateUnlocked, HasPassphrase: true, Keyring: api.KeyringOn}) {
		t.Fatalf("after a restart: %+v", got)
	}
	if s, err := resolve(t, restarted, ref); err != nil || s != "s3cret-password" {
		t.Fatalf("resolve: %q %v", s, err)
	}

	if err := restarted.SetKeyring(t.Context(), false); err != nil {
		t.Fatal(err)
	}
	if _, err := keyring.Get(keyringService, v.keyringUser()); !errors.Is(err, keyring.ErrNotFound) {
		t.Fatalf("the item is still there: %v", err)
	}
	locked := attach(t, dir)
	if got := locked.Status(); got != (api.Vault{State: api.VaultStateLocked, HasPassphrase: true, Keyring: api.KeyringOff}) {
		t.Fatalf("after moving to the passphrase: %+v", got)
	}
	if err := locked.UnlockPassphrase("pass"); err != nil {
		t.Fatal(err)
	}
	if err := locked.SetKeyring(t.Context(), true); err != nil {
		t.Fatal(err)
	}
	if got := attach(t, dir).Status(); got.State != api.VaultStateUnlocked {
		t.Fatalf("after moving back to the keyring: %+v", got)
	}
	if !bytes.Equal(readFile(t, filepath.Join(dir, "vault.age")), vaultAge) || !bytes.Equal(readFile(t, filepath.Join(dir, "vault.key.age")), wrapper) {
		t.Fatal("moving the key between keyring and passphrase rewrote vault.age or the wrapper")
	}
}

func TestAKeyFileWinsOverADifferentKeyInTheKeyring(t *testing.T) {
	keyring.MockInit()
	dir := t.TempDir()
	other := Open(t.TempDir())
	if err := other.UnlockKeyFile(keyFile(t)); err != nil {
		t.Fatal(err)
	}
	v := Open(dir)
	if err := v.UnlockKeyFile(keyFile(t)); err != nil {
		t.Fatal(err)
	}
	if err := keyring.Set(keyringService, v.keyringUser(), other.identity().String()); err != nil {
		t.Fatal(err)
	}
	if err := v.AttachKeyring(t.Context(), osKeyring{}); err != nil {
		t.Fatal(err)
	}
	if got := v.Status(); got.State != api.VaultStateUnlocked || got.Keyring != api.KeyringOff {
		t.Fatalf("%+v", got)
	}
}

// hangingKeyring answers every call except the one named in hang, which
// blocks like an unlock prompt nobody answers.
type hangingKeyring struct {
	hang    string
	release chan struct{}
	values  map[string]string
}

func (k *hangingKeyring) wait(call string) {
	if call == k.hang {
		<-k.release
	}
}

func (k *hangingKeyring) Set(_, user, secret string) error {
	k.wait("set")
	k.values[user] = secret
	return nil
}

func (k *hangingKeyring) Get(_, user string) (string, error) {
	if strings.HasPrefix(user, "canary-") {
		k.wait("get canary")
	} else {
		k.wait("get key")
	}
	if s, ok := k.values[user]; ok {
		return s, nil
	}
	return "", keyring.ErrNotFound
}

func (k *hangingKeyring) Delete(_, user string) error {
	k.wait("delete")
	delete(k.values, user)
	return nil
}

func TestAKeyringThatNeverAnswersFallsBackWithinTheDeadline(t *testing.T) {
	old := keyringTimeout
	keyringTimeout = 300 * time.Millisecond
	t.Cleanup(func() { keyringTimeout = old })
	dir := t.TempDir()
	if err := Open(dir).Create("pass"); err != nil {
		t.Fatal(err)
	}
	for _, hang := range []string{"set", "get canary", "delete", "get key"} {
		t.Run(hang, func(t *testing.T) {
			k := &hangingKeyring{hang: hang, release: make(chan struct{}), values: map[string]string{}}
			t.Cleanup(func() { close(k.release) })
			v := Open(dir)
			start := time.Now()
			err := v.AttachKeyring(t.Context(), k) // no deadline from the caller, as in main
			if took := time.Since(start); err == nil || took > keyringTimeout+200*time.Millisecond {
				t.Fatalf("AttachKeyring returned %v after %v", err, took)
			}
			if got := v.Status(); got != (api.Vault{State: api.VaultStateLocked, HasPassphrase: true, Keyring: api.KeyringUnavailable}) {
				t.Fatalf("%+v", got)
			}
			if err := v.UnlockPassphrase("pass"); err != nil {
				t.Fatalf("the passphrase must still unlock: %v", err)
			}
		})
	}
}

func TestAKeyringThatReturnsSomethingElseIsNotTrusted(t *testing.T) {
	keyring.MockInit()
	v := Open(t.TempDir())
	if err := v.AttachKeyring(t.Context(), garbling{}); err == nil || v.Status().Keyring != api.KeyringUnavailable {
		t.Fatalf("a keyring that garbles the canary was trusted: %v", err)
	}
}

type garbling struct{ osKeyring }

func (garbling) Get(service, user string) (string, error) {
	s, err := keyring.Get(service, user)
	return s + "x", err
}

func TestTheKeyringItemNameAvoidsBackslashAndQuote(t *testing.T) {
	a, b := Open(`C:\Users\o'brien\natter`).keyringUser(), Open(`/home/o'brien/.config/natter`).keyringUser()
	if strings.ContainsAny(a+b, `\'`) || a == b {
		t.Fatalf("%q %q", a, b)
	}
}
