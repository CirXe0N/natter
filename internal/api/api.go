// Package api holds the JSON shapes the backend sends to the browser.
// tygo turns them into web/src/gen/api.ts, so the frontend cannot drift from Go.
package api

import (
	"fmt"
	"io"
)

//go:generate go tool tygo generate

// Info describes the running natter binary.
type Info struct {
	Version string `json:"version"`
}

// Source says where a Context is stored.
type Source string

const (
	// SourceCLI is a natscli Context under ~/.config/nats/context/. Natter never writes it.
	SourceCLI Source = "cli"
	// SourceApp is a Context Natter created, under ~/.config/natter/nats/context/.
	// Its secret may be a Vault reference, which natscli cannot read.
	SourceApp Source = "app"
)

// SecretStorage says where a Context's secret lives. SecretStoragePlaintext marks a
// Plaintext secret: a literal or data: value, or a creds, nkey or TLS key file.
type SecretStorage string

const (
	SecretStorageNone      SecretStorage = "none"
	SecretStoragePlaintext SecretStorage = "plaintext"
	SecretStorageEnv       SecretStorage = "env"
	SecretStorageOp        SecretStorage = "op"
	SecretStorageNsc       SecretStorage = "nsc"
	SecretStorageVault     SecretStorage = "vault"
)

// Ref names one Context. Names are unique within a Source.
type Ref struct {
	Source Source `json:"source"`
	Name   string `json:"name"`
}

// Context is one entry on the Contexts screen. It never carries a secret.
type Context struct {
	Ref         `tstype:",extends"`
	Description string        `json:"description"`
	URLs        string        `json:"urls"`
	User        string        `json:"user"`
	Secret      SecretStorage `json:"secret"`
	Mode        Mode          `json:"mode"`
	Settings    `tstype:",extends"`
}

// Mode is how a Context's user is defined on the server.
type Mode string

const (
	ModeStatic Mode = "static" // a user in the server config
	ModeJWT    Mode = "jwt"    // creds, nsc or user_jwt: operator mode
)

// Settings are the Context fields natscontext files cannot hold. Natter keeps
// them in its own directory for every Source.
type Settings struct {
	MonitoringURL string `json:"monitoringUrl,omitempty"`
	// ReadOnly locks the Context in Read-only mode while it is active.
	ReadOnly bool `json:"readOnly,omitempty"`
}

// ConnStatus is the state of the connection to the active Context.
type ConnStatus string

const (
	ConnStatusNone         ConnStatus = "none" // no Context chosen yet
	ConnStatusConnecting   ConnStatus = "connecting"
	ConnStatusConnected    ConnStatus = "connected"
	ConnStatusReconnecting ConnStatus = "reconnecting"
	ConnStatusFailed       ConnStatus = "failed"
	// ConnStatusLocked means the Context's secret is in the Vault and the Vault is locked.
	ConnStatusLocked ConnStatus = "locked"
)

// Capabilities are detected when Natter connects to the active Context.
type Capabilities struct {
	// Account is the account the Context's user is bound to, from $SYS.REQ.USER.INFO.
	Account string `json:"account"`
	// System is true when the user is in the system account.
	System    bool `json:"system"`
	JetStream bool `json:"jetStream"`
	// Monitoring is true when the Context's Monitoring URL answered.
	Monitoring bool `json:"monitoring"`
}

// Active is the active Context and the state of its connection.
type Active struct {
	Context *Context   `json:"context"`
	Status  ConnStatus `json:"status"`
	// Error is the connect error, the server's own text where it sent one.
	Error        string       `json:"error,omitempty"`
	Server       string       `json:"server,omitempty"`
	Capabilities Capabilities `json:"capabilities"`
}

// JetStreamNames feeds the command palette: the active Context's streams and
// KV buckets, without the KV_ prefix on buckets.
type JetStreamNames struct {
	Streams []string `json:"streams"`
	Buckets []string `json:"buckets"`
}

// Secret is a password, token, creds file or nkey seed the browser sends once.
// It formats and encodes as [REDACTED], so fmt, slog and JSON never show it;
// only string(s) reveals it.
type Secret string

const redacted = "[REDACTED]"

func (Secret) Format(f fmt.State, _ rune)   { io.WriteString(f, redacted) }
func (Secret) MarshalJSON() ([]byte, error) { return []byte(`"` + redacted + `"`), nil }

// SecretKind is the Context field a new Context's secret goes into.
type SecretKind string

const (
	SecretKindPassword SecretKind = "password"
	SecretKindToken    SecretKind = "token"
	SecretKindCreds    SecretKind = "creds" // the whole .creds file
	SecretKindNkey     SecretKind = "nkey"  // the nkey seed
)

// NewContext creates a Context in Natter's own directory. Its secret, if
// any, goes into the Vault and the Context file holds only a reference.
type NewContext struct {
	Name        string     `json:"name"`
	Description string     `json:"description"`
	URLs        string     `json:"urls"`
	User        string     `json:"user"`
	SecretKind  SecretKind `json:"secretKind,omitempty"`
	// Secret goes into the Vault. SecretRef is an env://, op:// or nsc://
	// Secret reference stored as is. Give at most one of them.
	Secret    Secret `json:"secret,omitempty"`
	SecretRef string `json:"secretRef,omitempty"`
	// Source is SourceApp (the default) or SourceCLI, which writes natscli's own
	// directory. Only a Context with no Vault secret may go there.
	Source Source `json:"source,omitempty"`
}

// MoveRequest asks to copy a CLI Context with a Plaintext secret into Natter's
// directory, with the secret in the Vault. The CLI file is left as it is.
type MoveRequest struct {
	// Name of the new Natter Context; empty keeps the CLI Context's name.
	Name string `json:"name,omitempty"`
}

// RemoveRequest confirms deleting a CLI Context file. It is separate from
// moving, and Confirm must be true.
type RemoveRequest struct {
	Confirm bool `json:"confirm"`
}

// VaultState says whether the Vault exists and is unlocked.
type VaultState string

const (
	VaultStateNone     VaultState = "none" // no Vault file yet
	VaultStateLocked   VaultState = "locked"
	VaultStateUnlocked VaultState = "unlocked"
)

// KeyringState says whether the OS keyring holds the Vault key.
type KeyringState string

const (
	KeyringUnavailable KeyringState = "unavailable" // no OS keyring answered at startup
	KeyringOff         KeyringState = "off"
	KeyringOn          KeyringState = "on" // the Vault unlocks from the keyring at startup
)

// Vault is the state of the Vault. HasPassphrase is false for a Vault that
// only the key file passed with -vault-key can unlock.
type Vault struct {
	State         VaultState   `json:"state"`
	HasPassphrase bool         `json:"hasPassphrase"`
	Keyring       KeyringState `json:"keyring"`
}

// Passphrase is the body that creates or unlocks the Vault.
type Passphrase struct {
	Passphrase Secret `json:"passphrase"`
}

// Health is every server's HEALTHZ answer for the active Context.
type Health struct {
	Source StatsSource `json:"source"`
	// Problem says, for the user, what access is missing or why the check failed.
	Problem string         `json:"problem,omitempty"`
	Servers []ServerHealth `json:"servers"`
}

// ServerHealth is one server's HEALTHZ answer. Errors lists the failing
// accounts, streams and consumers when it is not healthy.
type ServerHealth struct {
	ID      string        `json:"id"`
	Name    string        `json:"name"`
	Healthy bool          `json:"healthy"`
	Errors  []HealthError `json:"errors"`
}

// HealthError is one failing asset. Type is the server's name for the kind of
// failure (CONNECTION, JETSTREAM, ACCOUNT, STREAM, CONSUMER, ...).
type HealthError struct {
	Type     string `json:"type"`
	Account  string `json:"account,omitempty"`
	Stream   string `json:"stream,omitempty"`
	Consumer string `json:"consumer,omitempty"`
	Error    string `json:"error"`
}
