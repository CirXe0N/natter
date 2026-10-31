package live

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"time"

	"github.com/nats-io/jsm.go/api"
	"github.com/nats-io/jsm.go/serverdata"
	"github.com/nats-io/nats-server/v2/server"
	"github.com/nats-io/nats.go"

	napi "github.com/CirXe0N/natter/internal/api"
	"github.com/CirXe0N/natter/internal/contexts"
)

const (
	// connzPage is the most connz returns per request.
	connzPage = server.DefaultConnListSize
	// maxConnections bounds one listing, so a huge fleet cannot flood the tab.
	// shortcut: a hard cap with a Truncated flag, add server-side paging in the API when 5000 is too few.
	maxConnections = 5000
	connzWait      = 2 * time.Second
)

// ErrNoSystem is Kick without System credentials.
var ErrNoSystem = errors.New("Kick needs System credentials.")

// ListConnections reads connz with auth, subs and the given state from every
// server: $SYS.REQ.SERVER.PING.CONNZ with System credentials, else /connz on
// the Monitoring URL. Each server is paged, since connz caps a page at 1024.
func ListConnections(ctx context.Context, a *contexts.Conn, state napi.ConnectionState) napi.Connections {
	st := server.ConnOpen
	if state == napi.ConnectionStateClosed {
		st = server.ConnClosed
	}
	src, conns, err := pick(a,
		func(nc *nats.Conn) ([]napi.Connection, error) { return connzSystem(ctx, nc, st) },
		func(u string) ([]napi.Connection, error) { return connzHTTP(ctx, u, state) })
	out := napi.Connections{Source: src, Connections: conns}
	if out.Connections == nil {
		out.Connections = []napi.Connection{}
	}
	if len(out.Connections) > maxConnections {
		out.Connections, out.Truncated = out.Connections[:maxConnections], true
	}
	if err != nil {
		out.Problem = err.Error()
	}
	return out
}

func connzOpts(st server.ConnState, offset int) server.ConnzEventOptions {
	return server.ConnzEventOptions{ConnzOptions: server.ConnzOptions{Username: true, Subscriptions: true, State: st, Offset: offset, Limit: connzPage}}
}

func connzSystem(ctx context.Context, nc *nats.Conn, st server.ConnState) ([]napi.Connection, error) {
	var out []napi.Connection
	answered := 0
	type more struct {
		id     string
		offset int
	}
	var todo []more
	log := api.NewDiscardLogger()
	err := serverdata.DoReqAsync(ctx, connzOpts(st, 0), "$SYS.REQ.SERVER.PING.CONNZ", 0, nc, connzWait, log, func(data []byte) {
		var r server.ServerAPIConnzResponse
		if json.Unmarshal(data, &r) != nil || r.Data == nil || r.Server == nil {
			return
		}
		answered++
		out = append(out, fromConnz(r.Server, r.Data)...)
		if n := len(r.Data.Conns); n > 0 && r.Data.Offset+n < r.Data.Total {
			todo = append(todo, more{r.Server.ID, r.Data.Offset + n})
		}
	})
	if err != nil {
		return nil, err
	}
	if answered == 0 {
		return nil, errors.New("No server answered $SYS.REQ.SERVER.PING.CONNZ.")
	}
	// The ping asked every server for its first page; the rest come from the
	// servers that hold more, one request each.
	for len(todo) > 0 && len(out) < maxConnections {
		t := todo[0]
		todo = todo[1:]
		err := serverdata.DoReqAsync(ctx, connzOpts(st, t.offset), fmt.Sprintf("$SYS.REQ.SERVER.%s.CONNZ", t.id), 1, nc, connzWait, log, func(data []byte) {
			var r server.ServerAPIConnzResponse
			if json.Unmarshal(data, &r) != nil || r.Data == nil || r.Server == nil {
				return
			}
			out = append(out, fromConnz(r.Server, r.Data)...)
			if n := len(r.Data.Conns); n > 0 && r.Data.Offset+n < r.Data.Total {
				todo = append(todo, more{t.id, r.Data.Offset + n})
			}
		})
		if err != nil {
			return out, err
		}
	}
	return out, nil
}

func connzHTTP(ctx context.Context, base string, state napi.ConnectionState) ([]napi.Connection, error) {
	var v server.Varz
	if err := getJSON(ctx, base, "varz", &v); err != nil {
		return nil, err
	}
	info := &server.ServerInfo{ID: v.ID, Name: v.Name}
	var out []napi.Connection
	for offset := 0; len(out) < maxConnections; {
		var c server.Connz
		q := url.Values{"auth": {"true"}, "subs": {"true"}, "state": {string(state)}, "offset": {fmt.Sprint(offset)}, "limit": {fmt.Sprint(connzPage)}}
		if err := getJSON(ctx, base, "connz?"+q.Encode(), &c); err != nil {
			return out, err
		}
		out = append(out, fromConnz(info, &c)...)
		offset += len(c.Conns)
		if len(c.Conns) == 0 || offset >= c.Total {
			break
		}
	}
	return out, nil
}

func fromConnz(s *server.ServerInfo, c *server.Connz) []napi.Connection {
	out := make([]napi.Connection, 0, len(c.Conns))
	for _, ci := range c.Conns {
		x := napi.Connection{
			Server: s.ID, ServerName: s.Name, Cid: ci.Cid, Name: ci.Name, Account: ci.Account, User: ci.AuthorizedUser,
			IP: ci.IP, Lang: ci.Lang, Version: ci.Version, Start: ci.Start, LastActivity: ci.LastActivity, Reason: ci.Reason,
			PendingBytes: ci.Pending, InMsgs: ci.InMsgs, OutMsgs: ci.OutMsgs, InBytes: ci.InBytes, OutBytes: ci.OutBytes,
			Subs: ci.Subs,
		}
		if x.Subs == nil {
			x.Subs = []string{}
		}
		if ci.Stop != nil {
			x.Stop = *ci.Stop
		}
		if d, err := time.ParseDuration(ci.RTT); err == nil {
			x.RTTMs = float64(d) / float64(time.Millisecond)
		}
		out = append(out, x)
	}
	return out
}

// Kick disconnects one Connection through $SYS.REQ.SERVER.<id>.KICK. The
// client may reconnect: a kick closes the connection, it does not ban.
func Kick(ctx context.Context, a *contexts.Conn, k napi.KickRequest) error {
	if a == nil || !a.Caps.System || a.NC == nil {
		return ErrNoSystem
	}
	if id, err := a.NC.GetClientID(); err == nil && id == k.Cid && a.NC.ConnectedServerId() == k.Server {
		return errors.New("That is Natter's own Connection. Kicking it would cut Natter off.")
	}
	res, err := serverdata.DoReq(ctx, server.KickClientReq{CID: k.Cid}, fmt.Sprintf("$SYS.REQ.SERVER.%s.KICK", k.Server), 1, a.NC, connzWait, api.NewDiscardLogger())
	if err != nil {
		return err
	}
	if len(res) == 0 {
		return fmt.Errorf("Server %s did not answer the kick.", k.Server)
	}
	var r server.ServerAPIResponse
	if err := json.Unmarshal(res[0], &r); err != nil {
		return err
	}
	if r.Error != nil {
		return errors.New(r.Error.Description)
	}
	return nil
}
