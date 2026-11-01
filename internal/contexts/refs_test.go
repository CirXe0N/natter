package contexts

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/nats-io/jsm.go/natscontext"

	"github.com/CirXe0N/natter/internal/api"
	"github.com/CirXe0N/natter/internal/natstest"
	"github.com/CirXe0N/natter/internal/vault"
)

// stub stands in for the 1Password and nsc CLIs at the resolver seam.
type stub struct {
	scheme string
	out    string
	err    error
	refs   []string
}

func (s *stub) Schemes() []string { return []string{s.scheme} }
func (s *stub) Resolve(_ context.Context, ref string) ([]byte, error) {
	s.refs = append(s.refs, ref)
	return []byte(s.out), s.err
}

func TestEachReferenceSchemeIsResolvedOnConnect(t *testing.T) {
	ns, root, _ := setup(t)
	t.Setenv("NATTER_TEST_REF", "app")
	op := &stub{scheme: "op", out: "app\n"}
	nsc := &stub{scheme: "nsc", err: errors.New("stub nsc: no profile")}
	m := New(root, vault.Open(filepath.Join(root, "natter")), op, nsc)
	t.Cleanup(m.Close)

	for _, n := range []api.NewContext{
		{Name: "by-env", User: "app", SecretKind: api.SecretKindPassword, SecretRef: "env://NATTER_TEST_REF"},
		{Name: "by-op", User: "app", SecretKind: api.SecretKindPassword, SecretRef: "op://vault/nats/password"},
		{Name: "by-nsc", SecretKind: api.SecretKindCreds, SecretRef: "nsc://op/acct/user"},
	} {
		n.URLs, n.Source = ns.ClientURL(), api.SourceCLI
		c, err := m.Create(t.Context(), n)
		if err != nil {
			t.Fatalf("%s: %v", n.Name, err)
		}
		if err := m.Activate(t.Context(), c.Ref); err != nil {
			t.Fatal(err)
		}
		a := m.Active()
		if n.Name == "by-nsc" {
			if a.Status != api.ConnStatusFailed || !strings.Contains(a.Err.Error(), "stub nsc: no profile") {
				t.Errorf("nsc: %v %v", a.Status, a.Err)
			}
			continue
		}
		if a.Status != api.ConnStatusConnected || a.Caps.Account != "APP" {
			t.Errorf("%s: %v %v", n.Name, a.Status, a.Err)
		}
	}
	if len(op.refs) != 1 || op.refs[0] != "op://vault/nats/password" || len(nsc.refs) != 1 || nsc.refs[0] != "nsc://op/acct/user" {
		t.Errorf("stubs saw op %v nsc %v", op.refs, nsc.refs)
	}
}

func TestCreateWithReferences(t *testing.T) {
	_, root, m := setup(t)
	if err := m.Vault().Create("pass"); err != nil {
		t.Fatal(err)
	}
	ref := func(n api.NewContext) api.NewContext { n.Name = "r"; return n }
	for name, n := range map[string]api.NewContext{
		"not a reference":      ref(api.NewContext{User: "u", SecretKind: api.SecretKindPassword, SecretRef: "hunter2"}),
		"vault reference":      ref(api.NewContext{User: "u", SecretKind: api.SecretKindPassword, SecretRef: "natter-vault://x"}),
		"nsc for a password":   ref(api.NewContext{User: "u", SecretKind: api.SecretKindPassword, SecretRef: "nsc://a/b/c"}),
		"secret and reference": ref(api.NewContext{User: "u", SecretKind: api.SecretKindPassword, SecretRef: "env://X", Secret: "y"}),
		"vault secret in CLI":  ref(api.NewContext{User: "u", SecretKind: api.SecretKindPassword, Secret: "y", Source: api.SourceCLI}),
		"unknown source":       ref(api.NewContext{Source: "elsewhere"}),
	} {
		if _, err := m.Create(t.Context(), n); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: %v", name, err)
		}
	}
	if _, err := m.Create(t.Context(), api.NewContext{Name: "r", URLs: "nats://x", User: "u", SecretKind: api.SecretKindPassword, SecretRef: "env://X"}); err != nil {
		t.Fatal(err) // in Natter's directory by default
	}
	if _, err := os.Stat(filepath.Join(root, "natter", "nats", "context", "r.json")); err != nil {
		t.Fatal(err)
	}
	// natscli reads this file, so it must hold the reference and no Vault URI.
	c, err := m.Create(t.Context(), api.NewContext{Name: "r", URLs: "nats://x", SecretKind: api.SecretKindCreds, SecretRef: "op://v/i/creds", Source: api.SourceCLI})
	if err != nil || c.Ref.Source != api.SourceCLI || c.Secret != api.SecretStorageOp {
		t.Fatalf("%+v %v", c, err)
	}
}

func TestUnknownSchemeOnCredsAndNkeyIsNatscliError(t *testing.T) {
	ns, root, m := setup(t)
	for _, f := range []string{"creds", "nkey"} {
		if err := natstest.WriteContext(root, "bad-"+f, map[string]string{"url": ns.ClientURL(), f: "keyring://x/y"}); err != nil {
			t.Fatal(err)
		}
		a := activate(t, m, "bad-"+f)
		if a.Status != api.ConnStatusFailed || !strings.Contains(a.Err.Error(), `no resolver registered for scheme "keyring"`) {
			t.Errorf("%s: %v %v", f, a.Status, a.Err)
		}
		if got := m.Status(); got.Status != api.ConnStatusFailed || !strings.Contains(got.Error, "keyring") {
			t.Errorf("%s: the UI would see %+v", f, got)
		}
	}
}

func TestMoveIntoVault(t *testing.T) {
	ns, root, m := setup(t)
	cliFile := filepath.Join(root, "nats", "context", "sys.json")
	before, err := os.ReadFile(cliFile)
	if err != nil {
		t.Fatal(err)
	}
	cli := api.Ref{Source: api.SourceCLI, Name: "sys"}

	if _, err := m.MoveIntoVault(t.Context(), cli, ""); !errors.Is(err, vault.ErrLocked) {
		t.Fatalf("locked Vault: %v", err)
	}
	if err := m.Vault().Create("pass"); err != nil {
		t.Fatal(err)
	}
	for name, ref := range map[string]api.Ref{
		"no secret to move": {Source: api.SourceCLI, Name: "app"},
		"an app Context":    {Source: api.SourceApp, Name: "sys"},
	} {
		if _, err := m.MoveIntoVault(t.Context(), ref, ""); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: %v", name, err)
		}
	}

	moved, err := m.MoveIntoVault(t.Context(), cli, "")
	if err != nil {
		t.Fatal(err)
	}
	if moved.Ref != (api.Ref{Source: api.SourceApp, Name: "sys"}) || moved.Secret != api.SecretStorageVault || moved.User != "sys" || moved.URLs != ns.ClientURL() {
		t.Fatalf("moved %+v", moved)
	}
	if after, _ := os.ReadFile(cliFile); string(after) != string(before) {
		t.Fatal("moving changed the CLI file")
	}
	file, _ := os.ReadFile(filepath.Join(root, "natter", "nats", "context", "sys.json"))
	if strings.Contains(string(file), `"password": "sys"`) || !strings.Contains(string(file), "natter-vault://") {
		t.Fatalf("the new file:\n%s", file)
	}
	if err := m.Activate(t.Context(), moved.Ref); err != nil {
		t.Fatal(err)
	}
	if a := m.Active(); a.Status != api.ConnStatusConnected || !a.Caps.System {
		t.Fatalf("connect: %v %v", a.Status, a.Err)
	}
	if _, err := m.MoveIntoVault(t.Context(), cli, ""); !errors.Is(err, ErrInvalid) {
		t.Fatalf("second move: %v", err)
	}

	// Removing is its own step.
	if err := m.Activate(t.Context(), cli); err != nil {
		t.Fatal(err)
	}
	if err := m.Remove(t.Context(), cli); !errors.Is(err, ErrInvalid) {
		t.Fatalf("remove the active Context: %v", err)
	}
	if err := m.Activate(t.Context(), moved.Ref); err != nil {
		t.Fatal(err)
	}
	if err := m.Remove(t.Context(), cli); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(cliFile); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("the CLI file is still there")
	}
}

func TestMoveReadsCredsFilesAndDataValues(t *testing.T) {
	ns, root, m := setup(t)
	if err := m.Vault().Create("pass"); err != nil {
		t.Fatal(err)
	}
	creds := filepath.Join(t.TempDir(), "u.creds")
	if err := os.WriteFile(creds, []byte("-----BEGIN NATS USER JWT-----\nx\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	for name, fields := range map[string]map[string]string{
		"file-creds": {"url": ns.ClientURL(), "creds": creds},
		"data-token": {"url": ns.ClientURL(), "token": "data:;base64,c2VjcmV0"},
		"bad-scheme": {"url": ns.ClientURL(), "creds": "keyring://x"},
		"user-seed":  {"url": ns.ClientURL(), "user_seed": "SUAXXX"},
	} {
		if err := natstest.WriteContext(root, name, fields); err != nil {
			t.Fatal(err)
		}
	}
	for _, name := range []string{"file-creds", "data-token"} {
		c, err := m.MoveIntoVault(t.Context(), api.Ref{Source: api.SourceCLI, Name: name}, name+"-v")
		if err != nil || c.Secret != api.SecretStorageVault {
			t.Fatalf("%s: %+v %v", name, c, err)
		}
	}
	for _, name := range []string{"bad-scheme", "user-seed"} {
		if _, err := m.MoveIntoVault(t.Context(), api.Ref{Source: api.SourceCLI, Name: name}, ""); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: %v", name, err)
		}
		if m.sources[api.SourceApp].raw.Known(t.Context(), name) {
			t.Errorf("%s: a Context was saved anyway", name)
		}
	}
	// the Vault holds what the file held
	l, err := natscontext.NewRegistry(natscontext.NewFileBackendAt(filepath.Join(root, "natter")), natscontext.WithoutExpansion()).Load(t.Context(), "file-creds-v")
	if err != nil {
		t.Fatal(err)
	}
	got, err := m.Vault().Resolve(t.Context(), l.Creds())
	if err != nil || !strings.Contains(string(got), "NATS USER JWT") {
		t.Fatalf("%q %v", got, err)
	}
}
