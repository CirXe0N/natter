package vault

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"testing"

	"filippo.io/age"

	"github.com/CirXe0N/natter/internal/api"
)

func keyFile(t *testing.T) string {
	t.Helper()
	id, err := age.GenerateHybridIdentity()
	if err != nil {
		t.Fatal(err)
	}
	p := filepath.Join(t.TempDir(), "natter.key")
	if err := os.WriteFile(p, []byte("# created: test\n"+id.String()+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

func resolve(t *testing.T, v *Vault, ref string) (string, error) {
	t.Helper()
	b, err := v.Resolve(t.Context(), ref)
	return string(b), err
}

func put(t *testing.T, v *Vault, s string) string {
	t.Helper()
	ref, err := v.Put(api.Secret(s))
	if err != nil {
		t.Fatal(err)
	}
	return ref
}

func TestKeyFileCreatesTheVaultAndUnlocksItAfterARestart(t *testing.T) {
	dir, key := t.TempDir(), keyFile(t)
	v := Open(dir)
	if got := v.Status(); got.State != api.VaultStateNone {
		t.Fatalf("fresh dir: %+v", got)
	}
	if err := v.UnlockKeyFile(key); err != nil {
		t.Fatal(err)
	}
	ref := put(t, v, "s3cret-password")
	if got := v.Status(); got != (api.Vault{State: api.VaultStateUnlocked, Keyring: api.KeyringUnavailable}) {
		t.Fatalf("after unlock: %+v", got)
	}

	file, err := os.ReadFile(filepath.Join(dir, "vault.age"))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(file, []byte("s3cret")) {
		t.Fatal("vault.age holds the secret in the clear")
	}
	if !bytes.HasPrefix(file, []byte("age-encryption.org/v1\n-> mlkem768x25519 ")) {
		t.Fatalf("vault.age is not encrypted to one hybrid post-quantum recipient:\n%.80q", file)
	}

	restarted := Open(dir)
	if got := restarted.Status(); got.State != api.VaultStateLocked {
		t.Fatalf("after restart: %+v", got)
	}
	if _, err := resolve(t, restarted, ref); !errors.Is(err, ErrLocked) {
		t.Fatalf("resolve while locked: %v", err)
	}
	if err := restarted.UnlockKeyFile(keyFile(t)); !errors.Is(err, ErrWrongKey) {
		t.Fatalf("another identity: %v", err)
	}
	if err := restarted.UnlockKeyFile(key); err != nil {
		t.Fatal(err)
	}
	if got, err := resolve(t, restarted, ref); err != nil || got != "s3cret-password" {
		t.Fatalf("resolve = %q, %v", got, err)
	}
}

func TestKeyFileMustHoldAPostQuantumIdentity(t *testing.T) {
	id, err := age.GenerateX25519Identity()
	if err != nil {
		t.Fatal(err)
	}
	p := filepath.Join(t.TempDir(), "x25519.key")
	if err := os.WriteFile(p, []byte(id.String()+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := Open(t.TempDir()).UnlockKeyFile(p); err == nil {
		t.Fatal("an X25519 identity was accepted")
	}
}

func TestPassphraseUnlocksAfterARestartAndChangingItRewritesOnlyTheWrapper(t *testing.T) {
	dir := t.TempDir()
	v := Open(dir)
	if err := v.Create("first passphrase"); err != nil {
		t.Fatal(err)
	}
	if err := Open(dir).Create("again"); !errors.Is(err, ErrExists) {
		t.Fatalf("second Create: %v", err)
	}
	ref := put(t, v, "a-token")
	payload, err := os.ReadFile(filepath.Join(dir, "vault.age"))
	if err != nil {
		t.Fatal(err)
	}

	for _, current := range []api.Secret{"", "not it"} {
		if err := v.SetPassphrase(current, "second passphrase"); !errors.Is(err, ErrWrongKey) && !errors.Is(err, ErrEmpty) {
			t.Fatalf("current %q: %v", current, err)
		}
	}
	if err := v.SetPassphrase("first passphrase", ""); !errors.Is(err, ErrEmpty) {
		t.Fatalf("empty new passphrase: %v", err)
	}
	if err := v.SetPassphrase("first passphrase", "second passphrase"); err != nil {
		t.Fatal(err)
	}
	after, err := os.ReadFile(filepath.Join(dir, "vault.age"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(payload, after) {
		t.Fatal("changing the passphrase rewrote vault.age")
	}

	restarted := Open(dir)
	if got := restarted.Status(); got != (api.Vault{State: api.VaultStateLocked, HasPassphrase: true, Keyring: api.KeyringUnavailable}) {
		t.Fatalf("after restart: %+v", got)
	}
	if err := restarted.UnlockPassphrase("first passphrase"); !errors.Is(err, ErrWrongKey) {
		t.Fatalf("old passphrase: %v", err)
	}
	if err := restarted.UnlockPassphrase("second passphrase"); err != nil {
		t.Fatal(err)
	}
	if got, err := resolve(t, restarted, ref); err != nil || got != "a-token" {
		t.Fatalf("resolve = %q, %v", got, err)
	}
}

func TestAKeyFileVaultGetsAPassphrase(t *testing.T) {
	dir := t.TempDir()
	v := Open(dir)
	if err := v.SetPassphrase("", "added"); !errors.Is(err, ErrLocked) {
		t.Fatalf("locked: %v", err)
	}
	if err := v.UnlockKeyFile(keyFile(t)); err != nil {
		t.Fatal(err)
	}
	ref := put(t, v, "a-token")
	if err := v.SetPassphrase("", "added"); err != nil {
		t.Fatal(err)
	}
	restarted := Open(dir)
	if err := restarted.UnlockPassphrase("added"); err != nil {
		t.Fatal(err)
	}
	if got, err := resolve(t, restarted, ref); err != nil || got != "a-token" {
		t.Fatalf("resolve = %q, %v", got, err)
	}
}

func TestPassphraseUnlockNeedsAWrapper(t *testing.T) {
	dir := t.TempDir()
	if err := Open(dir).UnlockKeyFile(keyFile(t)); err != nil {
		t.Fatal(err)
	}
	if err := Open(dir).UnlockPassphrase("anything"); !errors.Is(err, ErrNoPassphrase) {
		t.Fatalf("got %v", err)
	}
}

func TestFilesAreOwnerOnly(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("no Unix modes")
	}
	dir := t.TempDir()
	v := Open(dir)
	if err := v.Create("passphrase"); err != nil {
		t.Fatal(err)
	}
	put(t, v, "x")
	for _, name := range []string{"vault.age", "vault.key.age"} {
		st, err := os.Stat(filepath.Join(dir, name))
		if err != nil {
			t.Fatal(err)
		}
		if st.Mode().Perm() != 0o600 {
			t.Errorf("%s is %v", name, st.Mode().Perm())
		}
	}
}

// Two natter processes sharing one config directory must not lose each
// other's entries: each write re-reads the file under the lock.
func TestConcurrentWritersKeepEveryEntry(t *testing.T) {
	dir, key := t.TempDir(), keyFile(t)
	a, b := Open(dir), Open(dir)
	for _, v := range []*Vault{a, b} {
		if err := v.UnlockKeyFile(key); err != nil {
			t.Fatal(err)
		}
	}
	var wg sync.WaitGroup
	refs := make([]string, 20)
	for i := range refs {
		wg.Go(func() {
			v := []*Vault{a, b}[i%2]
			ref, err := v.Put(api.Secret(fmt.Sprint("secret-", i)))
			if err != nil {
				t.Error(err)
			}
			refs[i] = ref
		})
	}
	wg.Wait()
	for i, ref := range refs {
		if got, err := resolve(t, a, ref); err != nil || got != fmt.Sprint("secret-", i) {
			t.Errorf("entry %d = %q, %v", i, got, err)
		}
	}
}

func TestResolveUnknownEntry(t *testing.T) {
	v := Open(t.TempDir())
	if err := v.UnlockKeyFile(keyFile(t)); err != nil {
		t.Fatal(err)
	}
	if _, err := resolve(t, v, "natter-vault://nope"); err == nil {
		t.Fatal("an unknown entry resolved")
	}
}

func TestSecretRedactsItself(t *testing.T) {
	s := api.Secret("hunter2")
	withSecret := api.NewContext{Name: "x", SecretKind: api.SecretKindPassword, Secret: s}
	var out bytes.Buffer
	fmt.Fprintf(&out, "%v %+v %#v %s %q %x %d %v %+v|", s, s, s, s, s, s, s, withSecret, &withSecret)
	b, err := json.Marshal(withSecret)
	if err != nil {
		t.Fatal(err)
	}
	out.Write(b)
	slog.New(slog.NewJSONHandler(&out, nil)).Info("x", "secret", s, "ctx", withSecret)
	slog.New(slog.NewTextHandler(&out, nil)).Info("x", "secret", s, "ctx", withSecret)
	if bytes.Contains(out.Bytes(), []byte("hunter2")) || bytes.Contains(out.Bytes(), []byte("68756e74657232")) {
		t.Fatalf("leaked: %s", out.String())
	}
	var back api.NewContext
	if err := json.Unmarshal([]byte(`{"secret":"hunter2"}`), &back); err != nil || string(back.Secret) != "hunter2" {
		t.Fatalf("decoding a Secret: %q, %v", back.Secret, err)
	}
}
