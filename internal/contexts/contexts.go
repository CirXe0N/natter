// Package contexts is Natter's domain layer over natscontext. It lists
// Contexts from every Source, keeps which one is active, and holds the
// connection to it.
//
// Natter writes natscli's files only when the user asks: a new Context with no
// Vault secret may go there, and a CLI Context is deleted only on an explicit
// confirmation. The CLI Registry runs WithoutSelection, so
// ~/.config/nats/context.txt is never read or written. Natter's own state
// lives in <config root>/natter/.
package contexts

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"maps"
	"net/url"
	"os"
	"os/user"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/nats-io/jsm.go"
	"github.com/nats-io/jsm.go/natscontext"
	"github.com/nats-io/nats.go"

	"github.com/CirXe0N/natter/internal/api"
	"github.com/CirXe0N/natter/internal/atomicfile"
	"github.com/CirXe0N/natter/internal/vault"
)

var (
	// ErrUnknown means no Context has that Source and name.
	ErrUnknown = errors.New("unknown Context")
	// ErrInvalid means a value the user supplied was rejected.
	ErrInvalid = errors.New("invalid value")
)

// Manager owns the Contexts and the connection to the active one. Exactly one
// Context is active at a time; switching closes the previous connection.
type Manager struct {
	dir     string // Natter's own directory
	sources map[api.Source]registries
	vault   *vault.Vault

	switching sync.Mutex // serialises switches and writes to Natter's files
	active    atomic.Pointer[Conn]
}

// registries reads one Source. raw lists Contexts without expanding paths or
// running nsc; live loads one for connecting, with its secrets resolved.
type registries struct{ raw, live *natscontext.Registry }

// Conn is the active Context and its connection. A switch replaces it whole
// and never mutates it, so holders need no lock. NC is set only once Status is
// connected, and stays set while nats.go reconnects.
type Conn struct {
	Context api.Context
	Status  api.ConnStatus // connecting, connected, locked or failed
	Err     error
	NC      *nats.Conn
	Caps    api.Capabilities
	// JSM is set when Caps.JetStream is. It uses the Context's JetStream
	// domain and API prefix.
	JSM *jsm.Manager
}

// DefaultConfigRoot is where natscli keeps its Contexts: $XDG_CONFIG_HOME,
// else ~/.config, on every OS. natscontext uses the same rule.
func DefaultConfigRoot() (string, error) {
	if x := os.Getenv("XDG_CONFIG_HOME"); x != "" {
		return x, nil
	}
	u, err := user.Current()
	if err != nil {
		return "", err
	}
	return filepath.Join(u.HomeDir, ".config"), nil
}

// New reads natscli Contexts from root/nats/context/ and keeps Natter's state
// in root/natter/, its own Contexts in root/natter/nats/context/. Nothing
// outside root is read, so tests pass a temp dir. v resolves natter-vault://
// references; it normally lives in root/natter/ too. extra resolvers are added
// after the stock ones, so a test can replace op:// and nsc://.
func New(root string, v *vault.Vault, extra ...natscontext.CredentialResolver) *Manager {
	dir := filepath.Join(root, "natter")
	reg := func(b natscontext.Backend) registries {
		// Passing any resolver drops the defaults, so they are asked for explicitly.
		live := []natscontext.RegistryOption{natscontext.WithoutSelection(), natscontext.WithDefaultResolvers(), natscontext.WithCredentialResolver(v)}
		for _, r := range extra {
			live = append(live, natscontext.WithCredentialResolver(r))
		}
		return registries{
			raw:  natscontext.NewRegistry(b, natscontext.WithoutSelection(), natscontext.WithoutExpansion()),
			live: natscontext.NewRegistry(b, live...),
		}
	}
	return &Manager{
		dir:   dir,
		vault: v,
		sources: map[api.Source]registries{
			api.SourceCLI: reg(natscontext.NewFileBackendAt(root)),
			api.SourceApp: reg(natscontext.NewFileBackendAt(dir)),
		},
	}
}

// Vault is the Vault that holds the secrets of Natter's own Contexts.
func (m *Manager) Vault() *vault.Vault { return m.vault }

// secretOption is the natscontext field each kind of secret goes into.
var secretOption = map[api.SecretKind]func(string) natscontext.Option{
	api.SecretKindPassword: natscontext.WithPassword,
	api.SecretKindToken:    natscontext.WithToken,
	api.SecretKindCreds:    natscontext.WithCreds,
	api.SecretKindNkey:     natscontext.WithNKey,
}

// Create saves a new Context, in Natter's directory unless n.Source is the CLI.
// A Secret goes into the Vault and the file holds only the natter-vault://
// reference; a SecretRef is stored as is. Natter never writes a Plaintext secret.
func (m *Manager) Create(ctx context.Context, n api.NewContext) (_ api.Context, err error) {
	target := n.Source
	switch {
	case target == "":
		target = api.SourceApp
	case target == api.SourceCLI && n.Secret != "":
		return invalid("a Context with a Vault secret cannot go in natscli's directory, which cannot read the Vault")
	case target != api.SourceApp && target != api.SourceCLI:
		return invalid(fmt.Sprintf("unknown source %q", n.Source))
	}
	reg := m.sources[target].raw
	if err := natscontext.ValidateName(n.Name); err != nil {
		return invalid(err.Error())
	}
	if reg.Known(ctx, n.Name) {
		return invalid(fmt.Sprintf("a Context named %q already exists", n.Name))
	}
	opt, ok := secretOption[n.SecretKind]
	have := n.Secret != "" || n.SecretRef != ""
	switch {
	case n.SecretKind == "" && have:
		return invalid("say which field the secret is for")
	case n.SecretKind == "":
	case !ok:
		return invalid(fmt.Sprintf("unknown secret kind %q", n.SecretKind))
	case !have:
		return invalid("the secret is empty")
	case n.Secret != "" && n.SecretRef != "":
		return invalid("give a secret or a reference, not both")
	case n.SecretKind == api.SecretKindPassword && n.User == "":
		return invalid("a password needs a user")
	case (n.SecretKind == api.SecretKindCreds || n.SecretKind == api.SecretKindNkey) && n.User != "":
		return invalid("creds and nkey Contexts have no user")
	}
	if n.SecretRef != "" {
		if err := checkRef(n.SecretKind, n.SecretRef); err != nil {
			return invalid(err.Error())
		}
	}
	opts := []natscontext.Option{natscontext.WithServerURL(n.URLs), natscontext.WithDescription(n.Description), natscontext.WithUser(n.User)}
	var put []string
	defer m.forgetOnError(&err, &put)
	switch {
	case n.SecretRef != "":
		opts = append(opts, opt(n.SecretRef))
	case n.Secret != "":
		ref, err := m.vault.Put(n.Secret)
		if err != nil {
			return api.Context{}, err
		}
		put = append(put, ref)
		opts = append(opts, opt(ref))
	}
	c, err := natscontext.New(n.Name, false, opts...)
	if err != nil {
		return api.Context{}, err
	}
	if err := reg.Save(ctx, c, n.Name); err != nil {
		return api.Context{}, err
	}
	put = nil // the saved file references them now
	return m.Get(ctx, api.Ref{Source: target, Name: n.Name})
}

// forgetOnError deletes the Vault entries in *put when *err is set, so a
// Create or move that fails before its save leaves no orphan in the Vault.
func (m *Manager) forgetOnError(err *error, put *[]string) {
	if *err != nil && len(*put) > 0 {
		*err = errors.Join(*err, m.vault.Delete(*put...))
	}
}

// invalid is the error for a value the user supplied.
func invalid(msg string) (api.Context, error) {
	return api.Context{}, fmt.Errorf("%w: %s", ErrInvalid, msg)
}

// checkRef accepts the references natscli reads. nsc:// yields a creds file, so
// only the creds field may use it.
func checkRef(kind api.SecretKind, ref string) error {
	switch s := scheme(ref); {
	case s == "env" || s == "op":
	case s == "nsc" && kind == api.SecretKindCreds:
	case s == "nsc":
		return errors.New("nsc:// gives a creds file, so only the creds field can use it")
	default:
		return fmt.Errorf("a reference starts with env://, op:// or nsc://, not %q", ref)
	}
	return nil
}

// MoveIntoVault copies a CLI Context with a Plaintext secret into Natter's
// directory under newName (empty keeps the name), with its password, token,
// creds and nkey in the Vault. It never touches the CLI file; RemoveCLI does that.
func (m *Manager) MoveIntoVault(ctx context.Context, ref api.Ref, newName string) (_ api.Context, err error) {
	if ref.Source != api.SourceCLI {
		return invalid("only a nats CLI Context can be moved into the Vault")
	}
	if newName == "" {
		newName = ref.Name
	}
	if err := natscontext.ValidateName(newName); err != nil {
		return invalid(err.Error())
	}
	reg, err := m.registries(ref)
	if err != nil {
		return api.Context{}, err
	}
	c, err := reg.raw.Load(ctx, ref.Name)
	if errors.Is(err, natscontext.ErrNotFound) {
		return api.Context{}, fmt.Errorf("%w: %s", ErrUnknown, key(ref))
	}
	if err != nil {
		return api.Context{}, err
	}
	if secretStorage(c) != api.SecretStoragePlaintext {
		return invalid("this Context holds no Plaintext secret")
	}
	app := m.sources[api.SourceApp].raw
	if app.Known(ctx, newName) {
		return invalid(fmt.Sprintf("a Natter Context named %q already exists", newName))
	}
	// shortcut: user_seed and TLS key have no Vault kind, so a Plaintext one refuses the whole move; extend SecretKind if they matter.
	for field, v := range map[string]string{"user_seed": c.UserSeed(), "TLS key": c.Key()} {
		if v != "" && referenceSchemes[scheme(v)] == "" {
			return invalid(fmt.Sprintf("the %s is a Plaintext secret the Vault cannot hold yet", field))
		}
	}
	var opts []natscontext.Option
	var put []string
	defer m.forgetOnError(&err, &put)
	for _, f := range []struct {
		kind api.SecretKind
		val  string
	}{{api.SecretKindPassword, c.Password()}, {api.SecretKindToken, c.Token()}, {api.SecretKindCreds, c.Creds()}, {api.SecretKindNkey, c.NKey()}} {
		if f.val == "" || referenceSchemes[scheme(f.val)] != "" {
			continue
		}
		secret, err := plaintextValue(f.kind, f.val)
		if err != nil {
			return invalid(fmt.Sprintf("%s: %v", f.kind, err))
		}
		vref, err := m.vault.Put(secret)
		if err != nil {
			return api.Context{}, err
		}
		put = append(put, vref)
		opts = append(opts, secretOption[f.kind](vref))
	}
	// Load applies the options to the raw Context, so everything else is copied as is.
	moved, err := reg.raw.Load(ctx, ref.Name, opts...)
	if err != nil {
		return api.Context{}, err
	}
	if err := app.Save(ctx, moved, newName); err != nil {
		return api.Context{}, err
	}
	put = nil // the saved file references them now
	return m.Get(ctx, api.Ref{Source: api.SourceApp, Name: newName})
}

// plaintextValue reads a Plaintext secret the way natscli does: password and
// token are literals unless they start with file: or data:; creds and nkey are
// file paths, and a scheme other than file or data is natscli's error.
func plaintextValue(kind api.SecretKind, v string) (api.Secret, error) {
	var b []byte
	var err error
	switch s := scheme(v); {
	case s == "data":
		_, rest, _ := strings.Cut(v, ":")
		header, payload, _ := strings.Cut(rest, ",")
		if !strings.Contains(header, "base64") {
			return "", errors.New("a data: value must declare ;base64")
		}
		b, err = base64.StdEncoding.DecodeString(payload)
	case s == "file" || s == "" && (kind == api.SecretKindCreds || kind == api.SecretKindNkey):
		path := os.ExpandEnv(strings.TrimPrefix(v, "file://"))
		if rest, ok := strings.CutPrefix(path, "~/"); ok {
			home, herr := os.UserHomeDir()
			if herr != nil {
				return "", herr
			}
			path = filepath.Join(home, rest)
		}
		b, err = os.ReadFile(path)
	case kind == api.SecretKindCreds || kind == api.SecretKindNkey:
		return "", fmt.Errorf("no resolver registered for scheme %q", s)
	default:
		return api.Secret(v), nil
	}
	if err != nil {
		return "", err
	}
	return api.Secret(b), nil
}

// RemoveCLI deletes a CLI Context file. The caller has the user's explicit
// confirmation. The active Context is refused: switch away first.
func (m *Manager) RemoveCLI(ctx context.Context, ref api.Ref) error {
	if ref.Source != api.SourceCLI {
		return fmt.Errorf("%w: only a nats CLI Context file can be removed", ErrInvalid)
	}
	reg, err := m.registries(ref)
	if err != nil {
		return err
	}
	m.switching.Lock()
	defer m.switching.Unlock()
	if a := m.Active(); a != nil && a.Context.Ref == ref {
		return fmt.Errorf("%w: %s is the active Context; switch to another first", ErrInvalid, key(ref))
	}
	if !reg.raw.Known(ctx, ref.Name) {
		return fmt.Errorf("%w: %s", ErrUnknown, key(ref))
	}
	if err := reg.raw.Delete(ctx, ref.Name); err != nil {
		return err
	}
	return m.writeSettings(ref, api.Settings{})
}

// List returns every Context, by Source then name. A file natscontext cannot
// read is logged and left out, so one broken file does not hide the rest.
func (m *Manager) List(ctx context.Context) ([]api.Context, error) {
	settings, err := m.readSettings()
	if err != nil {
		return nil, err
	}
	out := []api.Context{}
	for _, src := range slices.Sorted(maps.Keys(m.sources)) {
		names, err := m.sources[src].raw.List(ctx)
		if err != nil {
			return nil, err
		}
		for _, name := range names {
			ref := api.Ref{Source: src, Name: name}
			c, err := m.sources[src].raw.Load(ctx, name)
			if err != nil {
				slog.Warn("skipping unreadable Context", "context", key(ref), "err", err)
				continue
			}
			out = append(out, summarize(ref, c, settings[key(ref)]))
		}
	}
	return out, nil
}

// Get returns one Context.
func (m *Manager) Get(ctx context.Context, ref api.Ref) (api.Context, error) {
	reg, err := m.registries(ref)
	if err != nil {
		return api.Context{}, err
	}
	c, err := reg.raw.Load(ctx, ref.Name)
	if errors.Is(err, natscontext.ErrNotFound) {
		return api.Context{}, fmt.Errorf("%w: %s", ErrUnknown, key(ref))
	}
	if err != nil {
		return api.Context{}, err
	}
	settings, err := m.readSettings()
	if err != nil {
		return api.Context{}, err
	}
	return summarize(ref, c, settings[key(ref)]), nil
}

func (m *Manager) registries(ref api.Ref) (registries, error) {
	reg, ok := m.sources[ref.Source]
	if !ok || natscontext.ValidateName(ref.Name) != nil {
		return registries{}, fmt.Errorf("%w: %s", ErrUnknown, key(ref))
	}
	return reg, nil
}

// Active returns the active Context and its connection, or nil before the
// user picks one. Callers must not close Conn.NC.
func (m *Manager) Active() *Conn { return m.active.Load() }

// Status describes the active Context for the browser.
func (m *Manager) Status() api.Active {
	a := m.Active()
	if a == nil {
		return api.Active{Status: api.ConnStatusNone}
	}
	out := api.Active{Context: &a.Context, Status: a.Status, Capabilities: a.Caps}
	if a.Err != nil {
		out.Error = a.Err.Error()
	}
	if a.NC != nil {
		out.Server = a.NC.ConnectedUrlRedacted()
		if !a.NC.IsConnected() {
			out.Status = api.ConnStatusReconnecting
		}
	}
	return out
}

// Activate makes ref the active Context, remembers it across restarts, and
// connects. A failed connect still leaves ref active, with Status failed, so
// the user sees the error and can retry. Only an unknown ref or a disk error
// is returned.
func (m *Manager) Activate(ctx context.Context, ref api.Ref) error {
	m.switching.Lock()
	defer m.switching.Unlock()
	return m.activate(ctx, ref)
}

// activate runs with m.switching held.
func (m *Manager) activate(ctx context.Context, ref api.Ref) error {
	ctx = context.WithoutCancel(ctx) // a closed browser tab must not leave a half-made switch
	c, err := m.Get(ctx, ref)
	if err != nil {
		return err
	}
	unlock, err := m.lockFile()
	if err != nil {
		return err
	}
	err = atomicfile.Write(m.activePath(), []byte(key(ref)+"\n"))
	unlock()
	if err != nil {
		return err
	}
	m.swap(&Conn{Context: c, Status: api.ConnStatusConnecting})
	m.swap(m.connect(ctx, c))
	return nil
}

// Restore reconnects to the Context that was active when Natter last ran.
func (m *Manager) Restore(ctx context.Context) error {
	b, err := os.ReadFile(m.activePath())
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	src, name, _ := strings.Cut(strings.TrimSpace(string(b)), "/")
	return m.Activate(ctx, api.Ref{Source: api.Source(src), Name: name})
}

// Close closes the active connection.
func (m *Manager) Close() { m.swap(nil) }

func (m *Manager) swap(c *Conn) {
	if old := m.active.Swap(c); old != nil && old.NC != nil {
		old.NC.Close()
	}
}

func (m *Manager) connect(ctx context.Context, c api.Context) *Conn {
	failed := func(err error) *Conn {
		if errors.Is(err, vault.ErrLocked) {
			return &Conn{Context: c, Status: api.ConnStatusLocked, Err: err}
		}
		return &Conn{Context: c, Status: api.ConnStatusFailed, Err: err}
	}
	nctx, err := m.sources[c.Source].live.Load(ctx, c.Name)
	if err != nil {
		return failed(err)
	}
	opts, err := nctx.NATSOptions(nats.Name("Natter"), nats.MaxReconnects(-1))
	if err != nil {
		return failed(err)
	}
	nc, err := nats.Connect(nctx.ServerURL(), opts...)
	if err != nil {
		return failed(err)
	}
	conn := &Conn{Context: c, Status: api.ConnStatusConnected, NC: nc, Caps: detect(ctx, nc, nctx, c.MonitoringURL)}
	if conn.Caps.JetStream {
		jopts, _ := nctx.JSMOptions() // never fails; detect already built a Manager from the same options
		conn.JSM, _ = jsm.New(nc, jopts...)
	}
	return conn
}

// SetSettings stores Natter's own fields for ref. If ref is active and its
// Monitoring URL changed, it reconnects so capabilities are detected again.
func (m *Manager) SetSettings(ctx context.Context, ref api.Ref, s api.Settings) error {
	old, err := m.Get(ctx, ref)
	if err != nil {
		return err
	}
	if s.MonitoringURL != "" {
		u, err := url.Parse(s.MonitoringURL)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			return fmt.Errorf("%w: the Monitoring URL must be an http:// or https:// address", ErrInvalid)
		}
	}
	m.switching.Lock() // so a concurrent switch to another Context is not undone
	defer m.switching.Unlock()
	if err := m.writeSettings(ref, s); err != nil {
		return err
	}
	a := m.Active()
	switch {
	case a == nil || a.Context.Ref != ref: // not active, nothing to refresh
	case old.MonitoringURL != s.MonitoringURL:
		return m.activate(ctx, ref)
	default: // same connection, fresh Settings
		next := *a
		next.Context.Settings = s
		m.active.Store(&next)
	}
	return nil
}

// writeSettings runs with m.switching held. The lock file covers the read
// too, so another natter process cannot slip a write in between.
func (m *Manager) writeSettings(ref api.Ref, s api.Settings) error {
	unlock, err := m.lockFile()
	if err != nil {
		return err
	}
	defer unlock()
	all, err := m.readSettings()
	if err != nil {
		return err
	}
	if s == (api.Settings{}) {
		delete(all, key(ref))
	} else {
		all[key(ref)] = s
	}
	b, err := json.MarshalIndent(all, "", "  ")
	if err != nil {
		return err
	}
	return atomicfile.Write(m.settingsPath(), b)
}

// readSettings reads contexts.json, which maps "source/name" to Settings.
func (m *Manager) readSettings() (map[string]api.Settings, error) {
	all := map[string]api.Settings{}
	b, err := os.ReadFile(m.settingsPath())
	if errors.Is(err, os.ErrNotExist) {
		return all, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(b, &all); err != nil {
		return nil, fmt.Errorf("%s: %w", m.settingsPath(), err)
	}
	return all, nil
}

// lockFile serialises writes to Natter's Context files across processes.
func (m *Manager) lockFile() (unlock func(), err error) {
	return atomicfile.Lock(filepath.Join(m.dir, "contexts.lock"))
}

func (m *Manager) activePath() string   { return filepath.Join(m.dir, "active-context") }
func (m *Manager) settingsPath() string { return filepath.Join(m.dir, "contexts.json") }

// key is a Ref as one string. natscontext names cannot hold "/", so it splits back.
func key(r api.Ref) string { return string(r.Source) + "/" + r.Name }
