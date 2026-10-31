package live

import (
	"context"
	"encoding/json"
	"fmt"
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
	src, servers, err := pick(a, func(nc *nats.Conn) ([]api.ServerHealth, error) { return healthzPing(ctx, nc) }, func(u string) ([]api.ServerHealth, error) { return healthzHTTP(ctx, u) })
	h := api.Health{Source: src, Servers: servers}
	if h.Servers == nil {
		h.Servers = []api.ServerHealth{}
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
	req, _ := json.Marshal(server.HealthzEventOptions{HealthzOptions: server.HealthzOptions{Details: true}})
	out := []api.ServerHealth{}
	err := gather(ctx, nc, "$SYS.REQ.SERVER.PING.HEALTHZ", req, healthzWait, func(data []byte) bool {
		var r struct {
			Server server.ServerInfo
			Data   server.HealthStatus
			Error  *server.ApiError
		}
		if json.Unmarshal(data, &r) != nil {
			return true
		}
		sh := api.ServerHealth{ID: r.Server.ID, Name: r.Server.Name}
		sh.Healthy, sh.Errors = healthyStatus(r.Data)
		if r.Error != nil {
			sh.Healthy = false
			sh.Errors = append(sh.Errors, api.HealthError{Type: "SERVER", Error: r.Error.Description})
		}
		out = append(out, sh)
		return true
	})
	if err != nil {
		return nil, err
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
	var hs server.HealthStatus
	if err := getJSON(ctx, base, "healthz?details=true", &hs); err != nil {
		return nil, err
	}
	sh := api.ServerHealth{ID: v.ID, Name: v.Name}
	sh.Healthy, sh.Errors = healthyStatus(hs)
	return []api.ServerHealth{sh}, nil
}
