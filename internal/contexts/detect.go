package contexts

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"time"

	"github.com/nats-io/jsm.go"
	"github.com/nats-io/jsm.go/natscontext"
	"github.com/nats-io/nats-server/v2/server"
	"github.com/nats-io/nats.go"

	"github.com/CirXe0N/natter/internal/api"
	"github.com/CirXe0N/natter/internal/vault"
)

// probeTimeout bounds each capability check, so a silent server costs seconds, not minutes.
const probeTimeout = 2 * time.Second

func summarize(ref api.Ref, c *natscontext.Context, s api.Settings) api.Context {
	mode := api.ModeStatic
	if c.Creds() != "" || c.NscURL() != "" || c.UserJWT() != "" {
		mode = api.ModeJWT
	}
	return api.Context{Ref: ref, Description: c.Description(), URLs: c.ServerURL(), User: c.User(), Secret: secretStorage(c), Mode: mode, Settings: s}
}

// referenceSchemes maps each Secret reference scheme to where its secret lives.
// Any other value is a Plaintext secret: a literal, a data: value, or a file.
var referenceSchemes = map[string]api.SecretStorage{
	"env": api.SecretStorageEnv,
	"op":  api.SecretStorageOp,
	"nsc": api.SecretStorageNsc,

	vault.Scheme: api.SecretStorageVault,
}

// secretStorage reads the raw, unexpanded Context. One Plaintext secret flags
// the whole Context.
func secretStorage(c *natscontext.Context) api.SecretStorage {
	found := api.SecretStorageNone
	if c.NscURL() != "" { // the deprecated "nsc" field
		found = api.SecretStorageNsc
	}
	for _, v := range []string{c.Password(), c.Token(), c.UserSeed(), c.Creds(), c.NKey(), c.Key()} {
		if v == "" {
			continue
		}
		s, ok := referenceSchemes[scheme(v)]
		if !ok {
			return api.SecretStoragePlaintext
		}
		found = s
	}
	return found
}

// scheme follows natscontext: url.Parse, lowercased, and at least two letters
// so a Windows path like C:\creds has none.
func scheme(v string) string {
	u, err := url.Parse(v)
	if err != nil || len(u.Scheme) < 2 {
		return ""
	}
	return u.Scheme
}

// detect asks the server what this Context may do. Each check fails closed.
func detect(ctx context.Context, nc *nats.Conn, c *natscontext.Context, monitoringURL string) api.Capabilities {
	var caps api.Capabilities
	if msg, err := request(ctx, nc, "$SYS.REQ.USER.INFO"); err == nil {
		var r struct {
			Data server.UserInfo `json:"data"`
		}
		if json.Unmarshal(msg.Data, &r) == nil {
			caps.Account = r.Data.Account
		}
	}
	// USER.INFO answers every account and does not say which one is the
	// system account. The server ping is only reachable from it.
	_, err := request(ctx, nc, "$SYS.REQ.SERVER.PING")
	caps.System = err == nil

	if opts, err := c.JSMOptions(jsm.WithTimeout(probeTimeout)); err == nil {
		if mgr, err := jsm.New(nc, opts...); err == nil {
			_, err = mgr.JetStreamAccountInfo() // $JS.API.INFO, under the Context's domain or prefix
			caps.JetStream = err == nil
		}
	}

	if monitoringURL != "" {
		caps.Monitoring = reachable(ctx, monitoringURL)
	}
	return caps
}

func request(ctx context.Context, nc *nats.Conn, subj string) (*nats.Msg, error) {
	ctx, cancel := context.WithTimeout(ctx, probeTimeout)
	defer cancel()
	return nc.RequestWithContext(ctx, subj, nil)
}

// reachable reports whether the Monitoring URL serves /varz.
func reachable(ctx context.Context, monitoringURL string) bool {
	u, err := url.JoinPath(monitoringURL, "varz")
	if err != nil {
		return false
	}
	ctx, cancel := context.WithTimeout(ctx, probeTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return false
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return false
	}
	resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}
