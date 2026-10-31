package live

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/nats-io/nats-server/v2/server"
	"github.com/nats-io/nats.go"

	"github.com/CirXe0N/natter/internal/api"
	"github.com/CirXe0N/natter/internal/contexts"
)

// statszWait bounds how long one poll collects STATSZ replies, and
// monitoringTimeout one Monitoring URL request. Both fit in the 1 s tick.
const (
	statszWait        = 500 * time.Millisecond
	monitoringTimeout = 800 * time.Millisecond
)

// Overview produces api.TopicOverview. Each second it samples every server of
// the active Context, through $SYS.REQ.SERVER.PING.STATSZ with System
// credentials or the Monitoring URL without, and keeps an hour of each series.
type Overview struct {
	active func() *contexts.Conn

	mu     sync.Mutex
	ref    api.Ref // whose servers the series hold; zero for none
	prev   map[string]sample
	series map[api.Series]*ring
	fresh  bool // the series were reset; the next frame carries History
	last   *api.Overview
}

// NewOverview samples whatever Context active returns on each tick.
func NewOverview(active func() *contexts.Conn) *Overview {
	o := &Overview{active: active}
	o.reset(api.Ref{})
	return o
}

// sample is one server's stats, from STATSZ or /varz and /jsz. The message
// and byte counts are cumulative since start.
type sample struct {
	server                             api.ServerSummary
	at                                 time.Time // the server's clock
	inMsgs, outMsgs, inBytes, outBytes int64
	slow                               int64
	js                                 *api.JetStreamUsage
}

func (o *Overview) Run(ctx context.Context, emit func([]byte, bool)) {
	t := time.NewTicker(time.Second)
	defer t.Stop()
	for {
		frame := o.tick(ctx, time.Now())
		b, err := json.Marshal(api.ServerFrame{Topic: api.TopicOverview, Overview: frame})
		if err != nil {
			slog.Error("encoding the Overview", "err", err)
		} else {
			emit(b, frame.History != nil)
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

func (o *Overview) Snapshot() []byte {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.last == nil {
		return nil
	}
	frame := *o.last
	frame.History = o.history()
	b, err := json.Marshal(api.ServerFrame{Topic: api.TopicOverview, Overview: &frame})
	if err != nil {
		slog.Error("encoding the Overview", "err", err)
		return nil
	}
	return b
}

func (o *Overview) tick(ctx context.Context, now time.Time) *api.Overview {
	a := o.active()
	src, samples, err := sampleAll(ctx, a)
	var problem string
	if err != nil {
		problem = err.Error()
	}
	var ref api.Ref
	if a != nil {
		ref = a.Context.Ref
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if ref != o.ref {
		o.reset(ref)
	}
	f := o.add(now.Unix(), samples)
	f.Source, f.Problem = src, problem
	o.last = f
	if o.fresh { // tabs hold the previous series; this frame replaces them
		o.fresh = false
		withHistory := *f
		withHistory.History = o.history()
		return &withHistory
	}
	return f
}

func (o *Overview) history() map[api.Series][]api.Num {
	h := map[api.Series][]api.Num{}
	for k, r := range o.series {
		h[k] = r.history()
	}
	return h
}

// reset forgets the series when the active Context changes: they described
// other servers.
func (o *Overview) reset(ref api.Ref) {
	o.ref, o.fresh = ref, true
	o.prev = map[string]sample{}
	o.series = map[api.Series]*ring{}
	for _, k := range []api.Series{api.SeriesConnections, api.SeriesMsgsIn, api.SeriesMsgsOut, api.SeriesBytesIn, api.SeriesBytesOut, api.SeriesSlowConsumers} {
		o.series[k] = newRing()
	}
}

// add turns one tick's samples into cluster totals and records them at sec.
// Rates come from each server's counter deltas over its own clock. A server
// seen for the first time, or with a changed start (it restarted, so its
// counters reset), has no rate yet, and the totals get a gap there instead of
// a partial sum or a negative spike.
func (o *Overview) add(sec int64, samples []sample) *api.Overview {
	nan := float32(math.NaN())
	f := &api.Overview{Time: sec, Points: map[api.Series]api.Num{}, Servers: []api.ServerSummary{}}
	totals := map[api.Series]float32{}
	if len(samples) == 0 {
		for k := range o.series {
			totals[k] = nan
		}
	}
	for _, s := range samples {
		f.Servers = append(f.Servers, s.server)
		totals[api.SeriesConnections] += float32(s.server.Connections)
		totals[api.SeriesSlowConsumers] += float32(s.slow)
		if s.js != nil {
			if f.JetStream == nil {
				f.JetStream = &api.JetStreamUsage{}
			}
			f.JetStream.Store += s.js.Store
			f.JetStream.MaxStore += s.js.MaxStore
			f.JetStream.Memory += s.js.Memory
			f.JetStream.MaxMemory += s.js.MaxMemory
		}
		p, seen := o.prev[s.server.ID]
		o.prev[s.server.ID] = s
		dt := s.at.Sub(p.at).Seconds()
		if !seen || !p.server.Start.Equal(s.server.Start) || dt <= 0 {
			for _, k := range []api.Series{api.SeriesMsgsIn, api.SeriesMsgsOut, api.SeriesBytesIn, api.SeriesBytesOut} {
				totals[k] = nan
			}
			continue
		}
		totals[api.SeriesMsgsIn] += float32(float64(s.inMsgs-p.inMsgs) / dt)
		totals[api.SeriesMsgsOut] += float32(float64(s.outMsgs-p.outMsgs) / dt)
		totals[api.SeriesBytesIn] += float32(float64(s.inBytes-p.inBytes) / dt)
		totals[api.SeriesBytesOut] += float32(float64(s.outBytes-p.outBytes) / dt)
	}
	for k, r := range o.series {
		r.put(sec, totals[k])
		f.Points[k] = api.Num(totals[k])
	}
	return f
}

// pick is the one source switch for server data: System credentials, else the
// Monitoring URL, else noAccess. Overview and Health both use it.
func pick[T any](a *contexts.Conn, system func(*nats.Conn) (T, error), monitoring func(url string) (T, error)) (api.StatsSource, T, error) {
	var zero T
	switch {
	case a != nil && a.Caps.System && a.NC != nil:
		v, err := system(a.NC)
		return api.StatsSourceSystem, v, err
	case a != nil && a.Context.MonitoringURL != "":
		v, err := monitoring(a.Context.MonitoringURL)
		return api.StatsSourceMonitoring, v, err
	}
	return api.StatsSourceNone, zero, noAccess(a)
}

// sampleAll picks the source the active Context allows and samples it. The
// error is for the user to read.
func sampleAll(ctx context.Context, a *contexts.Conn) (api.StatsSource, []sample, error) {
	return pick(a, func(nc *nats.Conn) ([]sample, error) { return statsz(ctx, nc) }, func(u string) ([]sample, error) { return monitoring(ctx, u) })
}

// gather publishes req to a $SYS ping subject and hands each reply to each
// until it returns false or wait runs out. Replies go to a private inbox.
func gather(ctx context.Context, nc *nats.Conn, subject string, req []byte, wait time.Duration, each func(data []byte) (more bool)) error {
	inbox := nc.NewInbox()
	sub, err := nc.SubscribeSync(inbox)
	if err != nil {
		return err
	}
	defer sub.Unsubscribe()
	if err := nc.PublishRequest(subject, inbox, req); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, wait)
	defer cancel()
	for {
		msg, err := sub.NextMsgWithContext(ctx)
		if err != nil || !each(msg.Data) {
			return nil
		}
	}
}

// noAccess says, for the user, why a Context cannot be sampled for server data.
func noAccess(a *contexts.Conn) error {
	switch {
	case a == nil:
		return errors.New("No Context is active. Choose one on the Contexts screen.")
	case a.Status == api.ConnStatusConnecting:
		return fmt.Errorf("Connecting to %s…", a.Context.Name)
	case a.Status == api.ConnStatusLocked:
		return fmt.Errorf("Unlock the Vault to connect to %s.", a.Context.Name)
	case a.Status == api.ConnStatusFailed:
		return fmt.Errorf("Could not connect to %s: %v", a.Context.Name, a.Err)
	default:
		return fmt.Errorf("Server stats need System credentials or a Monitoring URL. The Context %s has neither.", a.Context.Name)
	}
}

// statsz asks every server for its stats. The 10 s broadcast is too slow for
// 1 s points, so this polls; replies go to a private inbox, which the
// server's STATSZ rate limit does not cover.
func statsz(ctx context.Context, nc *nats.Conn) ([]sample, error) {
	var out []sample
	want := 1
	err := gather(ctx, nc, "$SYS.REQ.SERVER.PING.STATSZ", nil, statszWait, func(data []byte) bool {
		var m server.ServerStatsMsg
		if json.Unmarshal(data, &m) != nil {
			return true
		}
		want = max(want, m.Stats.ActiveServers)
		out = append(out, fromStatsz(m))
		return len(out) < want // stop early once every active server answered
	})
	if err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return nil, errors.New("No server answered $SYS.REQ.SERVER.PING.STATSZ.")
	}
	return out, nil
}

func fromStatsz(m server.ServerStatsMsg) sample {
	st := m.Stats
	s := sample{
		server: api.ServerSummary{ID: m.Server.ID, Name: m.Server.Name, Version: m.Server.Version, Cluster: m.Server.Cluster, Start: st.Start, Connections: st.Connections, CPU: st.CPU, Mem: st.Mem},
		at:     m.Server.Time,
		inMsgs: st.ReceivedFromClients.Msgs, outMsgs: st.SentToClients.Msgs,
		inBytes: st.ReceivedFromClients.Bytes, outBytes: st.SentToClients.Bytes,
		slow: st.SlowConsumers,
	}
	if js := st.JetStream; js != nil && js.Stats != nil && js.Config != nil {
		s.js = &api.JetStreamUsage{Store: js.Stats.Store, MaxStore: js.Config.MaxStore, Memory: js.Stats.Memory, MaxMemory: js.Config.MaxMemory}
	}
	return s
}

// monitoring reads /varz and /jsz from the Monitoring URL: one server.
func monitoring(ctx context.Context, base string) ([]sample, error) {
	var v server.Varz
	if err := getJSON(ctx, base, "varz", &v); err != nil {
		return nil, err
	}
	var js server.JSInfo
	if err := getJSON(ctx, base, "jsz", &js); err != nil {
		return nil, err
	}
	s := sample{
		server: api.ServerSummary{ID: v.ID, Name: v.Name, Version: v.Version, Cluster: v.Cluster.Name, Start: v.Start, Connections: v.Connections, CPU: v.CPU, Mem: v.Mem},
		at:     v.Now,
		inMsgs: v.InClientMsgs, outMsgs: v.OutClientMsgs,
		inBytes: v.InClientBytes, outBytes: v.OutClientBytes,
		slow: v.SlowConsumers,
	}
	if !js.Disabled {
		s.js = &api.JetStreamUsage{Store: js.Store, MaxStore: js.Config.MaxStore, Memory: js.Memory, MaxMemory: js.Config.MaxMemory}
	}
	return []sample{s}, nil
}

// getJSON decodes a Monitoring URL endpoint; path may carry a query. /healthz
// answers 503 with the same JSON body when unhealthy, so 503 is decoded too.
func getJSON(ctx context.Context, base, path string, v any) error {
	p, q, _ := strings.Cut(path, "?")
	u, err := url.JoinPath(base, p)
	if err != nil {
		return err
	}
	if q != "" {
		u += "?" + q
	}
	ctx, cancel := context.WithTimeout(ctx, monitoringTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("The Monitoring URL did not answer: %w", err)
	}
	defer resp.Body.Close()
	statusErr := fmt.Errorf("The Monitoring URL answered %s for /%s.", resp.Status, p)
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusServiceUnavailable {
		return statusErr
	}
	if err := json.NewDecoder(resp.Body).Decode(v); err != nil {
		if resp.StatusCode != http.StatusOK {
			return statusErr
		}
		return err
	}
	return nil
}
