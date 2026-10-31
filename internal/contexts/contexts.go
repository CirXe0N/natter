// Package contexts is Natter's domain layer over natscontext. It lists
// Contexts from every Source, keeps which one is active, and holds the
// connection to it.
//
// Natter never writes natscli's files. The CLI Registry runs WithoutSelection,
// so ~/.config/nats/context.txt is never read or written. Natter's own state
// lives in <config root>/natter/.
package contexts

import (
	"context"
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

	"github.com/nats-io/jsm.go/natscontext"
	"github.com/nats-io/nats.go"

	"github.com/CirXe0N/natter/internal/api"
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
	Status  api.ConnStatus // connecting, connected or failed
	Err     error
	NC      *nats.Conn
	Caps    api.Capabilities
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
// references; it normally lives in root/natter/ too.
func New(root string, v *vault.Vault) *Manager {
	dir := filepath.Join(root, "natter")
	reg := func(b natscontext.Backend) registries {
		return registries{
			raw: natscontext.NewRegistry(b, natscontext.WithoutSelection(), natscontext.WithoutExpansion()),
			// Passing any resolver drops the defaults, so they are asked for explicitly.
			live: natscontext.NewRegistry(b, natscontext.WithoutSelection(), natscontext.WithDefaultResolvers(), natscontext.WithCredentialResolver(v)),
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

// Create saves a new Context in Natter's own directory. Its secret goes into
// the Vault, and the Context file holds only the natter-vault:// reference.
func (m *Manager) Create(ctx context.Context, n api.NewContext) (api.Context, error) {
	invalid := func(msg string) (api.Context, error) { return api.Context{}, fmt.Errorf("%w: %s", ErrInvalid, msg) }
	reg := m.sources[api.SourceApp].raw
	if err := natscontext.ValidateName(n.Name); err != nil {
		return invalid(err.Error())
	}
	if reg.Known(ctx, n.Name) {
		return invalid(fmt.Sprintf("a Context named %q already exists", n.Name))
	}
	opt, ok := secretOption[n.SecretKind]
	switch {
	case n.SecretKind == "" && n.Secret != "":
		return invalid("say which field the secret is for")
	case n.SecretKind == "":
	case !ok:
		return invalid(fmt.Sprintf("unknown secret kind %q", n.SecretKind))
	case n.Secret == "":
		return invalid("the secret is empty")
	case n.SecretKind == api.SecretKindPassword && n.User == "":
		return invalid("a password needs a user")
	case (n.SecretKind == api.SecretKindCreds || n.SecretKind == api.SecretKindNkey) && n.User != "":
		return invalid("creds and nkey Contexts have no user")
	}
	opts := []natscontext.Option{natscontext.WithServerURL(n.URLs), natscontext.WithDescription(n.Description), natscontext.WithUser(n.User)}
	if ok {
		// shortcut: a failed Save leaves an unreferenced Vault entry; sweep orphans if Contexts become deletable.
		ref, err := m.vault.Put(n.Secret)
		if err != nil {
			return api.Context{}, err
		}
		opts = append(opts, opt(ref))
	}
	c, err := natscontext.New(n.Name, false, opts...)
	if err != nil {
		return api.Context{}, err
	}
	if err := reg.Save(ctx, c, n.Name); err != nil {
		return api.Context{}, err
	}
	return m.Get(ctx, api.Ref{Source: api.SourceApp, Name: n.Name})
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
	if err := writeFileAtomic(m.activePath(), []byte(key(ref)+"\n")); err != nil {
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
	return &Conn{Context: c, Status: api.ConnStatusConnected, NC: nc, Caps: detect(ctx, nc, nctx, c.MonitoringURL)}
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

// writeSettings runs with m.switching held.
func (m *Manager) writeSettings(ref api.Ref, s api.Settings) error {
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
	return writeFileAtomic(m.settingsPath(), b)
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

func (m *Manager) activePath() string   { return filepath.Join(m.dir, "active-context") }
func (m *Manager) settingsPath() string { return filepath.Join(m.dir, "contexts.json") }

// key is a Ref as one string. natscontext names cannot hold "/", so it splits back.
func key(r api.Ref) string { return string(r.Source) + "/" + r.Name }

// writeFileAtomic replaces path with data at mode 0600: temp file, fsync,
// rename, then a best-effort fsync of the directory (Windows cannot). A crash
// leaves the old file or the new one.
func writeFileAtomic(path string, data []byte) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	f, err := os.CreateTemp(dir, filepath.Base(path)+".tmp-*") // CreateTemp makes it 0600
	if err != nil {
		return err
	}
	defer os.Remove(f.Name()) // no-op after the rename
	if _, err := f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	if err := os.Rename(f.Name(), path); err != nil {
		return err
	}
	if d, err := os.Open(dir); err == nil {
		d.Sync()
		d.Close()
	}
	return nil
}
