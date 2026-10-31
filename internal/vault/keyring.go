package vault

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"path/filepath"
	"time"

	"filippo.io/age"
	"github.com/zalando/go-keyring"

	"github.com/CirXe0N/natter/internal/api"
)

// The OS keyring holds one item per Vault directory: the Vault key, never a
// secret (ADR-0002).
const keyringService = "natter"

// keyringTimeout bounds every keyring call. go-keyring takes no context and
// can wait forever on an unlock prompt nobody answers.
var keyringTimeout = 5 * time.Second

var ErrNoKeyring = errors.New("no OS keyring answered when natter started")

// Keyring is the part of zalando/go-keyring the Vault uses.
type Keyring interface {
	Set(service, user, secret string) error
	Get(service, user string) (string, error)
	Delete(service, user string) error
}

type osKeyring struct{}

func (osKeyring) Set(service, user, secret string) error   { return keyring.Set(service, user, secret) }
func (osKeyring) Get(service, user string) (string, error) { return keyring.Get(service, user) }
func (osKeyring) Delete(service, user string) error        { return keyring.Delete(service, user) }

// OSKeyring returns the platform keyring, or an error if there is clearly
// none. On Linux it checks the session bus first (see probe_linux.go).
func OSKeyring(ctx context.Context) (Keyring, error) {
	if _, err := within(ctx, func() (struct{}, error) { return struct{}{}, probe(ctx) }); err != nil {
		return nil, err
	}
	return osKeyring{}, nil
}

// within runs f, giving up when ctx ends or keyringTimeout passes. A call that
// never answers leaks its goroutine; after a failure the keyring is not used
// again, so at most a few leak.
func within[T any](ctx context.Context, f func() (T, error)) (T, error) {
	ctx, cancel := context.WithTimeout(ctx, keyringTimeout)
	defer cancel()
	type result struct {
		v   T
		err error
	}
	ch := make(chan result, 1)
	go func() {
		v, err := f()
		ch <- result{v, err}
	}()
	select {
	case r := <-ch:
		return r.v, r.err
	case <-ctx.Done():
		var zero T
		return zero, fmt.Errorf("the OS keyring did not answer: %w", ctx.Err())
	}
}

func do(ctx context.Context, f func() error) error {
	_, err := within(ctx, func() (struct{}, error) { return struct{}{}, f() })
	return err
}

// keyringUser names this Vault's item. It hashes the directory, so two
// config roots never share an item, and the name never holds `\` or `'`,
// which macOS's `security -i` mangles (zalando/go-keyring#154).
func (v *Vault) keyringUser() string {
	dir, err := filepath.Abs(v.dir)
	if err != nil {
		dir = v.dir
	}
	sum := sha256.Sum256([]byte(dir))
	return "vault-key-" + hex.EncodeToString(sum[:8])
}

// AttachKeyring trusts k only after a canary set, get and delete answer in
// time, all within one keyringTimeout. Then, if the Vault is locked and k
// holds its key, it unlocks. An error means k is not used: the Vault falls
// back to the key file or the passphrase.
func (v *Vault) AttachKeyring(ctx context.Context, k Keyring) error {
	ctx, cancel := context.WithTimeout(ctx, keyringTimeout)
	defer cancel()
	canary := "canary-" + rand.Text()
	if err := do(ctx, func() error { return k.Set(keyringService, canary, canary) }); err != nil {
		return err
	}
	got, err := within(ctx, func() (string, error) { return k.Get(keyringService, canary) })
	if err == nil && got != canary {
		err = errors.New("the OS keyring returned a different value than it was given")
	}
	if err == nil {
		err = do(ctx, func() error { return k.Delete(keyringService, canary) })
	}
	if err != nil {
		return err
	}
	stored, err := within(ctx, func() (string, error) { return k.Get(keyringService, v.keyringUser()) })
	if err != nil && !errors.Is(err, keyring.ErrNotFound) {
		return err
	}
	v.mu.Lock()
	v.keyring = k
	v.mu.Unlock()
	if errors.Is(err, keyring.ErrNotFound) || v.Status().State == api.VaultStateNone {
		return nil // an item left from a deleted Vault is overwritten on Create
	}
	id, err := age.ParseHybridIdentity(stored)
	if err != nil {
		return fmt.Errorf("the OS keyring item %s/%s: %w", keyringService, v.keyringUser(), err)
	}
	if cur := v.identity(); cur == nil {
		if err := v.unlock(id); err != nil {
			return fmt.Errorf("the key in the OS keyring: %w", err)
		}
	} else if cur.String() != id.String() {
		return nil // the key file won; the keyring holds some other key
	}
	v.mu.Lock()
	v.inKeyring = true
	v.mu.Unlock()
	return nil
}

func (v *Vault) keyringAttached() bool {
	v.mu.Lock()
	defer v.mu.Unlock()
	return v.keyring != nil
}

// SetKeyring stores the unlocked Vault key in the OS keyring, or removes it.
// Only the key moves: vault.age is not touched, and the passphrase wrapper
// stays, so the passphrase still unlocks the Vault.
func (v *Vault) SetKeyring(ctx context.Context, on bool) error {
	v.mu.Lock()
	k, id := v.keyring, v.id
	v.mu.Unlock()
	if k == nil {
		return ErrNoKeyring
	}
	if id == nil {
		return ErrLocked
	}
	err := do(ctx, func() error {
		if on {
			return k.Set(keyringService, v.keyringUser(), id.String())
		}
		return k.Delete(keyringService, v.keyringUser())
	})
	if err != nil && !(errors.Is(err, keyring.ErrNotFound) && !on) {
		return err
	}
	v.mu.Lock()
	v.inKeyring = on
	v.mu.Unlock()
	return nil
}
