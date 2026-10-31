package live

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"github.com/nats-io/nats-server/v2/server"
	"github.com/nats-io/nats.go"

	"github.com/CirXe0N/natter/internal/api"
	"github.com/CirXe0N/natter/internal/contexts"
)

const healthzWait = 750 * time.Millisecond

// CheckHealth asks every server of the active Context for HEALTHZ with
// details: through $SYS.REQ.SERVER.PING.HEALTHZ with System credentials, else
// through /healthz?details=true on the Monitoring URL (one server).
func CheckHealth(ctx context.Context, a *contexts.Conn) api.Health {
	h := api.Health{Source: api.OverviewSourceNone, Servers: []api.ServerHealth{}}
	var err error
	switch {
	case a != nil && a.Caps.System && a.NC != nil:
		h.Source = api.OverviewSourceSystem
		h.Servers, err = healthzPing(ctx, a.NC)
	case a != nil && a.Context.MonitoringURL != "":
		h.Source = api.OverviewSourceMonitoring
		h.Servers, err = healthzHTTP(ctx, a.Context.MonitoringURL)
	default:
		err = noAccess(a)
	}
	if err != nil {
		h.Problem = err.Error()
	}
	return h
}

func healthyStatus(hs server.HealthStatus) (bool, []api.HealthError) {
	errs := []api.HealthError{}
	for _, e := range hs.Errors {
		errs = append(errs, api.HealthError{Type: e.Type.String(), Account: e.Account, Stream: e.Stream, Consumer: e.Consumer, Error: e.Error})
	}
	if hs.Error != "" { // a server too old for details
		errs = append(errs, api.HealthError{Type: "SERVER", Error: hs.Error})
	}
	return len(errs) == 0 && hs.Status == "ok", errs
}

func healthzPing(ctx context.Context, nc *nats.Conn) ([]api.ServerHealth, error) {
	inbox := nc.NewInbox()
	sub, err := nc.SubscribeSync(inbox)
	if err != nil {
		return nil, err
	}
	defer sub.Unsubscribe()
	req, _ := json.Marshal(server.HealthzEventOptions{HealthzOptions: server.HealthzOptions{Details: true}})
	if err := nc.PublishRequest("$SYS.REQ.SERVER.PING.HEALTHZ", inbox, req); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, healthzWait)
	defer cancel()
	out := []api.ServerHealth{}
	for {
		msg, err := sub.NextMsgWithContext(ctx)
		if err != nil {
			break
		}
		var r struct {
			Server server.ServerInfo
			Data   server.HealthStatus
			Error  *server.ApiError
		}
		if json.Unmarshal(msg.Data, &r) != nil {
			continue
		}
		sh := api.ServerHealth{ID: r.Server.ID, Name: r.Server.Name}
		sh.Healthy, sh.Errors = healthyStatus(r.Data)
		if r.Error != nil {
			sh.Healthy = false
			sh.Errors = append(sh.Errors, api.HealthError{Type: "SERVER", Error: r.Error.Description})
		}
		out = append(out, sh)
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("No server answered $SYS.REQ.SERVER.PING.HEALTHZ.")
	}
	return out, nil
}

func healthzHTTP(ctx context.Context, base string) ([]api.ServerHealth, error) {
	var v server.Varz
	if err := getJSON(ctx, base, "varz", &v); err != nil {
		return nil, err
	}
	u, err := url.JoinPath(base, "healthz")
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, monitoringTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u+"?details=true", nil)
	if err != nil {
		return nil, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("The Monitoring URL did not answer: %w", err)
	}
	defer resp.Body.Close()
	// /healthz answers 503 with the same JSON body when unhealthy.
	var hs server.HealthStatus
	if err := json.NewDecoder(resp.Body).Decode(&hs); err != nil {
		return nil, fmt.Errorf("The Monitoring URL answered %s for /healthz.", resp.Status)
	}
	sh := api.ServerHealth{ID: v.ID, Name: v.Name}
	sh.Healthy, sh.Errors = healthyStatus(hs)
	return []api.ServerHealth{sh}, nil
}
