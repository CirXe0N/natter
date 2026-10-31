package contexts

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io/fs"
	"maps"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/nats-io/jsm.go/natscontext"
	"github.com/nats-io/nats-server/v2/server"

	"github.com/CirXe0N/natter/internal/api"
	"github.com/CirXe0N/natter/internal/natstest"
	"github.com/CirXe0N/natter/internal/vault"
)

// setup starts a server and writes one CLI Context per user into a fresh
// config root, so nothing reads the real ~/.config.
func setup(t *testing.T) (*server.Server, string, *Manager) {
	t.Helper()
	ns, err := natstest.Start(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(ns.Shutdown)
	root := t.TempDir()
	t.Setenv("NATTER_TEST_PASSWORD", "app")
	for name, fields := range map[string]map[string]string{
		"sys":   {"url": ns.ClientURL(), "user": "sys", "password": "sys"},
		"app":   {"url": ns.ClientURL(), "user": "app", "password": "env://NATTER_TEST_PASSWORD", "description": "the app user"},
		"nojs":  {"url": ns.ClientURL(), "user": "nojs", "password": "nojs"},
		"wrong": {"url": ns.ClientURL(), "user": "app", "password": "not-the-password"},
	} {
		if err := natstest.WriteContext(root, name, fields); err != nil {
			t.Fatal(err)
		}
	}
	m := New(root, vault.Open(filepath.Join(root, "natter")))
	t.Cleanup(m.Close)
	return ns, root, m
}

func activate(t *testing.T, m *Manager, name string) *Conn {
	t.Helper()
	if err := m.Activate(t.Context(), api.Ref{Source: api.SourceCLI, Name: name}); err != nil {
		t.Fatal(err)
	}
	return m.Active()
}

func TestDetectsEachCapability(t *testing.T) {
	ns, _, m := setup(t)
	monitoring := "http://" + ns.MonitorAddr().String()
	if err := m.SetSettings(t.Context(), api.Ref{Source: api.SourceCLI, Name: "app"}, api.Settings{MonitoringURL: monitoring}); err != nil {
		t.Fatal(err)
	}

	for _, tc := range []struct {
		name string
		want api.Capabilities
	}{
		{"sys", api.Capabilities{Account: "SYS", System: true}},
		{"app", api.Capabilities{Account: "APP", JetStream: true, Monitoring: true}},
		{"nojs", api.Capabilities{Account: "NOJS"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			a := activate(t, m, tc.name)
			if a.Status != api.ConnStatusConnected || a.Err != nil {
				t.Fatalf("status %s, err %v", a.Status, a.Err)
			}
			if a.Caps != tc.want {
				t.Fatalf("capabilities %+v, want %+v", a.Caps, tc.want)
			}
		})
	}
}

func TestUnreachableMonitoringURL(t *testing.T) {
	ns, _, m := setup(t)
	ref := api.Ref{Source: api.SourceCLI, Name: "app"}
	activate(t, m, "app")
	for _, u := range []string{"http://127.0.0.1:1", "http://" + ns.MonitorAddr().String() + "/not-monitoring"} {
		if err := m.SetSettings(t.Context(), ref, api.Settings{MonitoringURL: u}); err != nil {
			t.Fatal(err)
		}
		if a := m.Active(); a.Caps.Monitoring { // SetSettings reconnected the active Context
			t.Fatalf("%s counted as a reachable Monitoring URL", u)
		}
	}
	if err := m.SetSettings(t.Context(), ref, api.Settings{MonitoringURL: "file:///etc/passwd"}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("non-http Monitoring URL: err %v, want ErrInvalid", err)
	}
}

func TestUnchangedMonitoringURLKeepsTheConnection(t *testing.T) {
	_, _, m := setup(t)
	ref := api.Ref{Source: api.SourceCLI, Name: "app"}
	before := activate(t, m, "app")
	if err := m.SetSettings(t.Context(), ref, api.Settings{}); err != nil {
		t.Fatal(err)
	}
	if after := m.Active(); after.NC != before.NC || before.NC.IsClosed() {
		t.Fatal("saving unchanged Settings reconnected the active Context")
	}
}

func TestFailedConnectShowsServerError(t *testing.T) {
	_, _, m := setup(t)
	a := activate(t, m, "wrong")
	if a.Status != api.ConnStatusFailed || a.NC != nil {
		t.Fatalf("status %s, conn %v", a.Status, a.NC)
	}
	if got := m.Status(); got.Context.Name != "wrong" || !strings.Contains(strings.ToLower(got.Error), "authorization violation") {
		t.Fatalf("status %+v, want the server's Authorization Violation", got)
	}
}

func TestSwitchingClosesThePreviousConnection(t *testing.T) {
	_, _, m := setup(t)
	first := activate(t, m, "app")
	second := activate(t, m, "nojs")
	if !first.NC.IsClosed() {
		t.Fatal("previous connection still open after a switch")
	}
	if !second.NC.IsConnected() || m.Active() != second {
		t.Fatal("new Context is not the active connection")
	}
	if err := m.Activate(t.Context(), api.Ref{Source: api.SourceCLI, Name: "missing"}); !errors.Is(err, ErrUnknown) {
		t.Fatalf("unknown Context: err %v, want ErrUnknown", err)
	}
	if m.Active() != second {
		t.Fatal("an unknown Context replaced the active one")
	}
}

func TestActiveContextSurvivesRestartAndCLIFilesAreUntouched(t *testing.T) {
	_, root, m := setup(t)
	before := tree(t, filepath.Join(root, "nats"))

	activate(t, m, "app")
	if _, err := m.List(t.Context()); err != nil {
		t.Fatal(err)
	}
	m.Close()

	again := New(root, vault.Open(filepath.Join(root, "natter")))
	t.Cleanup(again.Close)
	if err := again.Restore(t.Context()); err != nil {
		t.Fatal(err)
	}
	if a := again.Active(); a == nil || a.Context.Name != "app" || a.Status != api.ConnStatusConnected {
		t.Fatalf("restored %+v, want app connected", a)
	}
	if after := tree(t, filepath.Join(root, "nats")); !maps.Equal(before, after) {
		t.Fatalf("natscli's directory changed:\nbefore %v\nafter  %v", before, after)
	}
	if _, err := natscontext.NewRegistry(natscontext.NewFileBackendAt(root)).Selected(context.Background()); !errors.Is(err, natscontext.ErrNoneSelected) {
		t.Fatalf("natscli has a selected Context: %v", err)
	}
}

func TestListFlagsPlaintextSecrets(t *testing.T) {
	_, _, m := setup(t)
	got, err := m.List(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	secrets := map[string]api.SecretStorage{}
	for _, c := range got {
		secrets[c.Name] = c.Secret
	}
	want := map[string]api.SecretStorage{"app": api.SecretStorageEnv, "nojs": api.SecretStoragePlaintext, "sys": api.SecretStoragePlaintext, "wrong": api.SecretStoragePlaintext}
	if !maps.Equal(secrets, want) {
		t.Fatalf("secrets %v, want %v", secrets, want)
	}
}

func TestSecretStorage(t *testing.T) {
	for _, tc := range []struct {
		fields map[string]string
		want   api.SecretStorage
	}{
		{map[string]string{}, api.SecretStorageNone},
		{map[string]string{"user": "a", "password": "literal"}, api.SecretStoragePlaintext},
		{map[string]string{"token": "s3cr3t"}, api.SecretStoragePlaintext},
		{map[string]string{"token": "unknown://x"}, api.SecretStoragePlaintext}, // natscontext passes unknown schemes through as the literal
		{map[string]string{"user": "a", "password": "keyring://x"}, api.SecretStoragePlaintext},
		{map[string]string{"user_jwt": "eyJ...", "user_seed": "keyring://x"}, api.SecretStoragePlaintext},
		{map[string]string{"creds": "keyring://x"}, api.SecretStorageUnknownReference}, // natscontext refuses it: a broken Secret reference
		{map[string]string{"nkey": "keyring://x"}, api.SecretStorageUnknownReference},
		{map[string]string{"cert": "/tls/cert.pem", "key": "keyring://x"}, api.SecretStorageUnknownReference},
		{map[string]string{"token": "s3cr3t", "creds": "keyring://x"}, api.SecretStorageUnknownReference}, // broken outranks Plaintext
		{map[string]string{"password": "env://PW"}, api.SecretStorageEnv},
		{map[string]string{"password": "OP://vault/item/pw"}, api.SecretStorageOp},
		{map[string]string{"creds": "nsc://operator/account/user"}, api.SecretStorageNsc},
		{map[string]string{"nsc": "nsc://operator/account/user"}, api.SecretStorageNsc},
		{map[string]string{"nkey": "natter-vault://abc"}, api.SecretStorageVault},
		{map[string]string{"creds": "/home/me/user.creds"}, api.SecretStoragePlaintext},
		{map[string]string{"creds": "file:///home/me/user.creds"}, api.SecretStoragePlaintext},
		{map[string]string{"creds": `C:\creds\user.creds`}, api.SecretStoragePlaintext},
		{map[string]string{"creds": "data:;base64,AAAA"}, api.SecretStoragePlaintext},
		{map[string]string{"nkey": "~/.nkeys/user.nk"}, api.SecretStoragePlaintext},
		{map[string]string{"user_jwt": "eyJ...", "user_seed": "SUA..."}, api.SecretStoragePlaintext},
		{map[string]string{"cert": "/tls/cert.pem", "key": "/tls/key.pem"}, api.SecretStoragePlaintext},
		{map[string]string{"cert": "/tls/cert.pem", "ca": "/tls/ca.pem"}, api.SecretStorageNone},
		{map[string]string{"password": "env://PW", "key": "/tls/key.pem"}, api.SecretStoragePlaintext}, // one Plaintext secret flags the Context
	} {
		root := t.TempDir()
		if err := natstest.WriteContext(root, "c", tc.fields); err != nil {
			t.Fatal(err)
		}
		c, err := New(root, vault.Open(t.TempDir())).Get(t.Context(), api.Ref{Source: api.SourceCLI, Name: "c"})
		if err != nil {
			t.Fatal(err)
		}
		if c.Secret != tc.want {
			t.Errorf("%v: secret %q, want %q", tc.fields, c.Secret, tc.want)
		}
	}
}

// tree hashes every file under dir.
func tree(t *testing.T, dir string) map[string][32]byte {
	t.Helper()
	out := map[string][32]byte{}
	err := filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		b, err := os.ReadFile(p)
		out[p] = sha256.Sum256(b)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	return out
}

// Two Managers on one directory stand in for two natter processes: each
// read-modify-write of contexts.json holds the lock file, so no entry is lost.
func TestConcurrentSettingsWritersKeepEveryEntry(t *testing.T) {
	root := t.TempDir()
	refs := make([]api.Ref, 20)
	for i := range refs {
		refs[i] = api.Ref{Source: api.SourceCLI, Name: fmt.Sprint("c", i)}
		if err := natstest.WriteContext(root, refs[i].Name, map[string]string{"url": "nats://127.0.0.1:1"}); err != nil {
			t.Fatal(err)
		}
	}
	ms := []*Manager{New(root, vault.Open(t.TempDir())), New(root, vault.Open(t.TempDir()))}
	var wg sync.WaitGroup
	for i, ref := range refs {
		wg.Go(func() {
			if err := ms[i%2].SetSettings(t.Context(), ref, api.Settings{ReadOnly: true}); err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	list, err := ms[0].List(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range list {
		if !c.ReadOnly {
			t.Errorf("%s lost its Settings", c.Name)
		}
	}
}
