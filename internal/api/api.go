// Package api holds the JSON shapes the backend sends to the browser.
// tygo turns them into web/src/gen/api.ts, so the frontend cannot drift from Go.
package api

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
