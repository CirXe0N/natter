package live

import (
	"context"
	"encoding/json"
	"math"
	"strings"
	"testing"
	"time"

	"github.com/nats-io/nats.go"

	"github.com/CirXe0N/natter/internal/api"
	"github.com/CirXe0N/natter/internal/contexts"
	"github.com/CirXe0N/natter/internal/natstest"
	"github.com/CirXe0N/natter/internal/vault"
)

// frame is the Overview as the browser decodes it: a missing point is nil.
type frame struct {
	Overview struct {
		Source    api.StatsSource
		Problem   string
		Points    map[api.Series]*float64
		History   map[api.Series][]*float64
		Servers   []api.ServerSummary
		JetStream *api.JetStreamUsage
	}
}

// startOverview starts an Overview over the given Context of a fresh embedded
// server, with app publishing in the background, and returns its frames.
func startOverview(t *testing.T, name string, settings api.Settings) (*Overview, <-chan frame) {
	t.Helper()
	ns, err := natstest.Start(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(ns.Shutdown)
	root := t.TempDir()
	for _, user := range []string{"sys", "app", "nojs"} {
		if err := natstest.WriteContext(root, user, map[string]string{"url": ns.ClientURL(), "user": user, "password": user}); err != nil {
			t.Fatal(err)
		}
	}
	m := contexts.New(root, vault.Open(t.TempDir()))
	t.Cleanup(m.Close)
	ref := api.Ref{Source: api.SourceCLI, Name: name}
	settings.MonitoringURL = strings.ReplaceAll(settings.MonitoringURL, "MONITOR", "http://"+ns.MonitorAddr().String())
	if err := m.SetSettings(t.Context(), ref, settings); err != nil {
		t.Fatal(err)
	}
	if err := m.Activate(t.Context(), ref); err != nil {
		t.Fatal(err)
	}

	pub, err := nats.Connect(ns.ClientURL(), nats.UserInfo("app", "app"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pub.Close)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	go func() {
		for ctx.Err() == nil {
			pub.Publish("traffic", []byte("hello"))
			time.Sleep(5 * time.Millisecond)
		}
	}()

	o := NewOverview(m.Active)
	frames := make(chan frame, 100)
	go o.Run(ctx, func(b []byte, _ bool) {
		var f frame
		if err := json.Unmarshal(b, &f); err != nil {
			t.Error(err)
		}
		frames <- f
	})
	return o, frames
}

// await returns the first frame within 5 s that has a msgsIn rate.
func await(t *testing.T, frames <-chan frame) frame {
	t.Helper()
	timeout := time.After(5 * time.Second)
	for {
		select {
		case f := <-frames:
			if p := f.Overview.Points[api.SeriesMsgsIn]; p != nil {
				return f
			}
		case <-timeout:
			t.Fatal("no frame with a msgsIn rate within 5 s")
		}
	}
}

func TestStatszProducerEmitsRates(t *testing.T) {
	o, frames := startOverview(t, "sys", api.Settings{})
	f := await(t, frames).Overview

	if f.Source != api.StatsSourceSystem || len(f.Servers) != 1 || f.Problem != "" {
		t.Fatalf("source %s, %d servers, problem %q", f.Source, len(f.Servers), f.Problem)
	}
	if in := *f.Points[api.SeriesMsgsIn]; in < 50 { // app publishes about 200/s
		t.Errorf("msgsIn %v/s", in)
	}
	if b := f.Points[api.SeriesBytesIn]; b == nil || *b <= 0 {
		t.Errorf("bytesIn %v", b)
	}
	if c := f.Points[api.SeriesConnections]; c == nil || *c < 2 {
		t.Errorf("connections %v; want natter and the publisher", c)
	}
	if f.Servers[0].Version == "" || f.Servers[0].Start.IsZero() {
		t.Errorf("server row %+v", f.Servers[0])
	}
	if f.JetStream == nil || f.JetStream.MaxStore <= 0 {
		t.Errorf("JetStream %+v", f.JetStream)
	}

	var snap frame
	if err := json.Unmarshal(o.Snapshot(), &snap); err != nil {
		t.Fatal(err)
	}
	h := snap.Overview.History[api.SeriesMsgsIn]
	if len(h) != Slots || h[Slots-1] == nil || h[0] != nil {
		t.Fatalf("history: %d slots, newest %v, oldest %v", len(h), h[Slots-1], h[0])
	}
}

func TestMonitoringURLIsTheFallback(t *testing.T) {
	_, frames := startOverview(t, "app", api.Settings{MonitoringURL: "MONITOR"})
	f := await(t, frames).Overview
	if f.Source != api.StatsSourceMonitoring || len(f.Servers) != 1 || *f.Points[api.SeriesMsgsIn] < 50 || f.JetStream == nil {
		t.Fatalf("%+v", f)
	}
}

func TestWithoutAccessTheOverviewSaysWhatIsMissing(t *testing.T) {
	_, frames := startOverview(t, "nojs", api.Settings{})
	f := (<-frames).Overview
	if f.Source != api.StatsSourceNone || !strings.Contains(f.Problem, "System credentials or a Monitoring URL") || len(f.Servers) != 0 {
		t.Fatalf("%+v", f)
	}
	if len(f.History[api.SeriesConnections]) != Slots {
		t.Errorf("first frame after a reset carries %d history slots", len(f.History[api.SeriesConnections]))
	}
	if next := (<-frames).Overview; next.History != nil {
		t.Error("the next frame repeats the history")
	}
}

func TestRestartLeavesAGapInsteadOfANegativeRate(t *testing.T) {
	o := NewOverview(nil)
	boot, reboot := time.Unix(1000, 0), time.Unix(2000, 0)
	at := func(sec int64, start time.Time, msgs int64) []sample {
		return []sample{{server: api.ServerSummary{ID: "n1", Start: start}, at: time.Unix(sec, 0), inMsgs: msgs}}
	}
	in := func(f *api.Overview) float64 { return float64(f.Points[api.SeriesMsgsIn]) }

	if r := in(o.add(3000, at(3000, boot, 100))); !math.IsNaN(r) {
		t.Errorf("first sample has rate %v; want none", r)
	}
	if r := in(o.add(3002, at(3002, boot, 140))); r != 20 {
		t.Errorf("rate %v; want 20/s over the server's 2 s", r)
	}
	if r := in(o.add(3003, at(3003, reboot, 5))); !math.IsNaN(r) {
		t.Errorf("rate across a restart %v; want a gap", r)
	}
	if r := in(o.add(3004, at(3004, reboot, 15))); r != 10 {
		t.Errorf("rate after the restart %v; want 10", r)
	}

	h := o.series[api.SeriesMsgsIn].history()
	if h[Slots-1] != 10 || !math.IsNaN(float64(h[Slots-2])) || h[Slots-3] != 20 || !math.IsNaN(float64(h[Slots-4])) {
		t.Errorf("history tail %v; want a skipped second, 20, the restart's gap, 10", h[Slots-4:])
	}
}

func TestALockedVaultSaysToUnlockIt(t *testing.T) {
	a := &contexts.Conn{Context: api.Context{Ref: api.Ref{Source: api.SourceApp, Name: "vaulted"}}, Status: api.ConnStatusLocked}
	src, _, err := sampleAll(context.Background(), a)
	if src != api.StatsSourceNone || err == nil || !strings.Contains(err.Error(), "Unlock the Vault") {
		t.Fatalf("%v %v", src, err)
	}
}
