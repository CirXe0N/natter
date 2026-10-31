package live

import (
	"testing"
	"time"

	"github.com/nats-io/nats.go"

	"github.com/CirXe0N/natter/internal/api"
	"github.com/CirXe0N/natter/internal/contexts"
	"github.com/CirXe0N/natter/internal/natstest"
	"github.com/CirXe0N/natter/internal/vault"
)

func connectionsFixture(t *testing.T) (*contexts.Manager, string, string) {
	t.Helper()
	ns, err := natstest.Start(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(ns.Shutdown)
	root := t.TempDir()
	for _, user := range []string{"sys", "app"} {
		if err := natstest.WriteContext(root, user, map[string]string{"url": ns.ClientURL(), "user": user, "password": user}); err != nil {
			t.Fatal(err)
		}
	}
	m := contexts.New(root, vault.Open(t.TempDir()))
	t.Cleanup(m.Close)
	return m, ns.ClientURL(), "http://" + ns.MonitorAddr().String()
}

func use(t *testing.T, m *contexts.Manager, name string, s api.Settings) *contexts.Conn {
	t.Helper()
	ref := api.Ref{Source: api.SourceCLI, Name: name}
	if err := m.SetSettings(t.Context(), ref, s); err != nil {
		t.Fatal(err)
	}
	if err := m.Activate(t.Context(), ref); err != nil {
		t.Fatal(err)
	}
	return m.Active()
}

func find(cs []api.Connection, name string) *api.Connection {
	for i := range cs {
		if cs[i].Name == name {
			return &cs[i]
		}
	}
	return nil
}

// A client with a name and a subscription shows up through both sources, with
// its account, user and subject; after a kick it is gone from the open list,
// sits in the closed one with a reason, and an RTT parses to milliseconds.
func TestListAndKickAConnection(t *testing.T) {
	m, url, mon := connectionsFixture(t)
	disconnected := make(chan struct{})
	victim, err := nats.Connect(url, nats.UserInfo("app", "app"), nats.Name("victim"), nats.NoReconnect(), nats.DisconnectErrHandler(func(*nats.Conn, error) { close(disconnected) }))
	if err != nil {
		t.Fatal(err)
	}
	defer victim.Close()
	if _, err := victim.SubscribeSync("orders.>"); err != nil {
		t.Fatal(err)
	}
	if err := victim.Flush(); err != nil {
		t.Fatal(err)
	}

	for name, s := range map[string]api.Settings{"sys": {}, "app": {MonitoringURL: mon}} {
		a := use(t, m, name, s)
		l := ListConnections(t.Context(), a, api.ConnectionStateOpen)
		c := find(l.Connections, "victim")
		if c == nil || l.Problem != "" {
			t.Fatalf("%s: %+v", name, l)
		}
		if c.Account != "APP" || c.User != "app" || len(c.Subs) != 1 || c.Subs[0] != "orders.>" || c.Server == "" {
			t.Errorf("%s: %+v", name, c)
		}
	}

	a := use(t, m, "sys", api.Settings{})
	victimCID, err := victim.GetClientID()
	if err != nil {
		t.Fatal(err)
	}
	c := find(ListConnections(t.Context(), a, api.ConnectionStateOpen).Connections, "victim")
	if c.Cid != victimCID {
		t.Fatalf("cid %d, want %d", c.Cid, victimCID)
	}
	if err := Kick(t.Context(), a, api.KickRequest{Server: c.Server, Cid: c.Cid}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-disconnected:
	case <-time.After(5 * time.Second):
		t.Fatal("the kicked client was not disconnected")
	}
	if find(ListConnections(t.Context(), a, api.ConnectionStateOpen).Connections, "victim") != nil {
		t.Error("still listed as open")
	}
	closed := find(ListConnections(t.Context(), a, api.ConnectionStateClosed).Connections, "victim")
	if closed == nil || closed.Reason == "" || closed.Stop.IsZero() {
		t.Errorf("closed: %+v", closed)
	}
}

// Kick needs System credentials, and refuses to cut Natter itself off.
func TestKickRefusals(t *testing.T) {
	m, _, mon := connectionsFixture(t)
	app := use(t, m, "app", api.Settings{MonitoringURL: mon})
	if err := Kick(t.Context(), app, api.KickRequest{Server: "x", Cid: 1}); err != ErrNoSystem {
		t.Errorf("without System credentials: %v", err)
	}
	sys := use(t, m, "sys", api.Settings{})
	cid, _ := sys.NC.GetClientID()
	if err := Kick(t.Context(), sys, api.KickRequest{Server: sys.NC.ConnectedServerId(), Cid: cid}); err == nil {
		t.Error("kicked itself")
	}
	if err := Kick(t.Context(), sys, api.KickRequest{Server: sys.NC.ConnectedServerId(), Cid: 999999}); err == nil {
		t.Error("kicking an unknown cid reported success")
	}
}

// More Connections than one connz page come back whole, from both sources.
func TestListPagesPastOneConnzPage(t *testing.T) {
	m, url, mon := connectionsFixture(t)
	const n = connzPage + 50
	for range n {
		nc, err := nats.Connect(url, nats.UserInfo("app", "app"), nats.Name("bulk"), nats.NoReconnect())
		if err != nil {
			t.Fatal(err)
		}
		defer nc.Close()
	}
	for name, s := range map[string]api.Settings{"sys": {}, "app": {MonitoringURL: mon}} {
		l := ListConnections(t.Context(), use(t, m, name, s), api.ConnectionStateOpen)
		got := 0
		for _, c := range l.Connections {
			if c.Name == "bulk" {
				got++
			}
		}
		if got != n || l.Problem != "" {
			t.Errorf("%s: %d bulk Connections, want %d (%s)", name, got, n, l.Problem)
		}
	}
}

func TestListWithoutAccessSaysSo(t *testing.T) {
	m, _, _ := connectionsFixture(t)
	l := ListConnections(t.Context(), use(t, m, "app", api.Settings{}), api.ConnectionStateOpen)
	if l.Source != api.StatsSourceNone || l.Problem == "" || len(l.Connections) != 0 {
		t.Errorf("%+v", l)
	}
}
