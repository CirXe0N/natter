// Package vault is Natter's encrypted store for Context secrets (ADR-0002).
//
// Every secret lives in one age file, vault.age, encrypted to a hybrid
// post-quantum age identity. That identity comes from a plaintext key file
// passed with -vault-key, or from vault.key.age, a copy of it wrapped with a
// passphrase (scrypt). Changing the passphrase rewrites only that wrapper.
//
// An unlocked Vault holds only the identity in memory. Every read and write
// decrypts the file again, and writes do it under vault.lock, so two natter
// processes sharing a directory never lose each other's entries.
package vault

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"filippo.io/age"

	"github.com/CirXe0N/natter/internal/api"
	"github.com/CirXe0N/natter/internal/atomicfile"
)

// Scheme is the Secret reference scheme: natter-vault://<opaque-id>.
const Scheme = "natter-vault"

var (
	// ErrLocked means the Vault must be unlocked first. Resolve returns it at
	// once rather than waiting for an unlock.
	ErrLocked       = errors.New("the Vault is locked")
	ErrWrongKey     = errors.New("wrong passphrase or key file for this Vault")
	ErrExists       = errors.New("a Vault already exists")
	ErrNoPassphrase = errors.New("this Vault has no passphrase: start natter with -vault-key <key file>")
	ErrEmpty        = errors.New("the passphrase is empty")
)

// Vault is the Vault in one directory. The zero identity means locked.
type Vault struct {
	dir string
	mu  sync.Mutex
	id  *age.HybridIdentity
	// keyring is nil unless an OS keyring passed the canary at startup.
	keyring   Keyring
	inKeyring bool
}

type payload struct {
	Version int               `json:"v"`
	Entries map[string][]byte `json:"entries"`
}

// Open returns the locked Vault kept in dir. It touches nothing on disk.
func Open(dir string) *Vault { return &Vault{dir: dir} }

func (v *Vault) path(name string) string { return filepath.Join(v.dir, name) }

func (v *Vault) identity() *age.HybridIdentity {
	v.mu.Lock()
	defer v.mu.Unlock()
	return v.id
}

// Status reports whether the Vault exists, is unlocked, and has a passphrase.
func (v *Vault) Status() api.Vault {
	_, err := os.Stat(v.path("vault.key.age"))
	out := api.Vault{State: api.VaultStateUnlocked, HasPassphrase: err == nil, Keyring: api.KeyringUnavailable}
	v.mu.Lock()
	if v.keyring != nil {
		out.Keyring = api.KeyringOff
		if v.inKeyring {
			out.Keyring = api.KeyringOn
		}
	}
	v.mu.Unlock()
	if v.identity() == nil {
		out.State = api.VaultStateLocked
		if _, err := os.Stat(v.path("vault.age")); errors.Is(err, os.ErrNotExist) {
			out.State = api.VaultStateNone
		}
	}
	return out
}

// UnlockKeyFile unlocks with the age identity in path, creating an empty
// Vault encrypted to it if there is none yet.
func (v *Vault) UnlockKeyFile(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	ids, err := age.ParseIdentities(f)
	if err != nil {
		return fmt.Errorf("%s: %w", path, err)
	}
	id, ok := ids[0].(*age.HybridIdentity)
	if !ok || len(ids) > 1 {
		return fmt.Errorf("%s must hold exactly one post-quantum age identity; create one with `age-keygen -pq -o %s`", path, path)
	}
	return v.unlock(id)
}

// UnlockPassphrase unwraps the identity from vault.key.age and unlocks.
func (v *Vault) UnlockPassphrase(passphrase api.Secret) error {
	wrapped, err := os.ReadFile(v.path("vault.key.age"))
	if errors.Is(err, os.ErrNotExist) {
		return ErrNoPassphrase
	}
	if err != nil {
		return err
	}
	if passphrase == "" {
		return ErrEmpty
	}
	sid, err := age.NewScryptIdentity(string(passphrase))
	if err != nil {
		return err
	}
	r, err := age.Decrypt(bytes.NewReader(wrapped), sid)
	if errors.As(err, new(*age.NoIdentityMatchError)) {
		return ErrWrongKey
	}
	if err != nil {
		return err
	}
	b, err := io.ReadAll(r)
	if err != nil {
		return err
	}
	id, err := age.ParseHybridIdentity(strings.TrimSpace(string(b)))
	if err != nil {
		return fmt.Errorf("vault.key.age: %w", err)
	}
	return v.unlock(id)
}

// Create makes a new Vault with a fresh identity wrapped by passphrase, and
// leaves it unlocked. If an OS keyring is attached, it also gets the key, so
// the Vault unlocks at startup; failing that is not an error.
func (v *Vault) Create(passphrase api.Secret) error {
	id, err := age.GenerateHybridIdentity()
	if err != nil {
		return err
	}
	wrapped, err := wrap(id, passphrase)
	if err != nil {
		return err
	}
	unlockFile, err := v.lockFile()
	if err != nil {
		return err
	}
	defer unlockFile()
	if _, err := os.Stat(v.path("vault.age")); err == nil {
		return ErrExists
	}
	if err := atomicfile.Write(v.path("vault.key.age"), wrapped); err != nil {
		return err
	}
	if err := v.unlockLocked(id, true); err != nil {
		return err
	}
	if v.keyringAttached() {
		_ = v.SetKeyring(context.Background(), true)
	}
	return nil
}

// SetPassphrase wraps the unlocked identity with a new passphrase. vault.age
// is left as it is.
func (v *Vault) SetPassphrase(passphrase api.Secret) error {
	id := v.identity()
	if id == nil {
		return ErrLocked
	}
	wrapped, err := wrap(id, passphrase)
	if err != nil {
		return err
	}
	unlockFile, err := v.lockFile()
	if err != nil {
		return err
	}
	defer unlockFile()
	return atomicfile.Write(v.path("vault.key.age"), wrapped)
}

func wrap(id *age.HybridIdentity, passphrase api.Secret) ([]byte, error) {
	if passphrase == "" {
		return nil, ErrEmpty
	}
	r, err := age.NewScryptRecipient(string(passphrase))
	if err != nil {
		return nil, err
	}
	return encrypt([]byte(id.String()+"\n"), r)
}

// unlock checks that id opens vault.age, or creates an empty one.
func (v *Vault) unlock(id *age.HybridIdentity) error {
	unlockFile, err := v.lockFile()
	if err != nil {
		return err
	}
	defer unlockFile()
	return v.unlockLocked(id, false)
}

// unlockLocked runs with vault.lock held. A missing vault.age is created
// empty: either the caller asked for it, or this is the first key file.
func (v *Vault) unlockLocked(id *age.HybridIdentity, create bool) error {
	_, err := read(v.path("vault.age"), id)
	if errors.Is(err, os.ErrNotExist) || create {
		err = write(v.path("vault.age"), id, map[string][]byte{})
	}
	if err != nil {
		return err
	}
	v.mu.Lock()
	v.id = id
	v.mu.Unlock()
	return nil
}

// Put stores s under a new opaque ID and returns its Secret reference.
func (v *Vault) Put(s api.Secret) (string, error) {
	id := v.identity()
	if id == nil {
		return "", ErrLocked
	}
	unlockFile, err := v.lockFile()
	if err != nil {
		return "", err
	}
	defer unlockFile()
	entries, err := read(v.path("vault.age"), id)
	if err != nil {
		return "", err
	}
	key := strings.ToLower(rand.Text())
	entries[key] = []byte(s)
	if err := write(v.path("vault.age"), id, entries); err != nil {
		return "", err
	}
	return Scheme + "://" + key, nil
}

// Schemes and Resolve make the Vault a natscontext.CredentialResolver.
func (v *Vault) Schemes() []string { return []string{Scheme} }

// Resolve returns the secret a natter-vault:// reference names, or ErrLocked
// at once. Errors name the entry, never its value.
func (v *Vault) Resolve(_ context.Context, ref string) ([]byte, error) {
	id := v.identity()
	if id == nil {
		return nil, ErrLocked
	}
	_, key, _ := strings.Cut(ref, "://")
	entries, err := read(v.path("vault.age"), id)
	if err != nil {
		return nil, err
	}
	s, ok := entries[key]
	if !ok {
		return nil, fmt.Errorf("the Vault has no entry %q", key)
	}
	return s, nil // a fresh slice: natscontext wipes it after use
}

func read(path string, id age.Identity) (map[string][]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	r, err := age.Decrypt(f, id)
	if errors.As(err, new(*age.NoIdentityMatchError)) {
		return nil, ErrWrongKey
	}
	if err != nil {
		return nil, err
	}
	var p payload
	if err := json.NewDecoder(io.LimitReader(r, 16<<20)).Decode(&p); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	if p.Entries == nil {
		p.Entries = map[string][]byte{}
	}
	return p.Entries, nil
}

func write(path string, id *age.HybridIdentity, entries map[string][]byte) error {
	plain, err := json.Marshal(payload{Version: 1, Entries: entries})
	if err != nil {
		return err
	}
	defer clear(plain)
	b, err := encrypt(plain, id.Recipient())
	if err != nil {
		return err
	}
	return atomicfile.Write(path, b)
}

func encrypt(plain []byte, r age.Recipient) ([]byte, error) {
	var buf bytes.Buffer
	w, err := age.Encrypt(&buf, r)
	if err != nil {
		return nil, err
	}
	if _, err := w.Write(plain); err != nil {
		return nil, err
	}
	if err := w.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// lockFile takes vault.lock, which serialises writers across goroutines and
// processes.
func (v *Vault) lockFile() (unlock func(), err error) { return atomicfile.Lock(v.path("vault.lock")) }
