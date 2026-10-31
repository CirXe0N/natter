package live

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/CirXe0N/natter/internal/api"
	"github.com/CirXe0N/natter/internal/contexts"
	"github.com/CirXe0N/natter/internal/natstest"
	"github.com/CirXe0N/natter/internal/vault"
)

// A stream directory with no recoverable stream behind it makes the server
// report an unhealthy asset, through both sources.
func TestHealthListsAnUnhealthyStream(t *testing.T) {
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
	use := func(name string, s api.Settings) api.Health {
		t.Helper()
		ref := api.Ref{Source: api.SourceCLI, Name: name}
		if err := m.SetSettings(t.Context(), ref, s); err != nil {
			t.Fatal(err)
		}
		if err := m.Activate(t.Context(), ref); err != nil {
			t.Fatal(err)
		}
		return CheckHealth(t.Context(), m.Active())
	}
	mon := api.Settings{MonitoringURL: "http://" + ns.MonitorAddr().String()}

	for name, s := range map[string]api.Settings{"sys": {}, "app": mon} {
		if h := use(name, s); len(h.Servers) != 1 || !h.Servers[0].Healthy || len(h.Servers[0].Errors) != 0 {
			t.Fatalf("%s: a fresh server is unhealthy: %+v", name, h)
		}
	}

	if err := os.MkdirAll(filepath.Join(ns.JetStreamConfig().StoreDir, "APP", "streams", "ghost"), 0o700); err != nil {
		t.Fatal(err)
	}
	for name, s := range map[string]api.Settings{"sys": {}, "app": mon} {
		h := use(name, s)
		if len(h.Servers) != 1 || h.Servers[0].Healthy || len(h.Servers[0].Errors) != 1 {
			t.Fatalf("%s: %+v", name, h)
		}
		if e := h.Servers[0].Errors[0]; e.Type != "STREAM" || e.Account != "APP" || e.Stream != "ghost" || !strings.Contains(e.Error, "could not be recovered") {
			t.Errorf("%s: %+v", name, e)
		}
	}

	if h := use("nojs", api.Settings{}); h.Source != api.StatsSourceNone || !strings.Contains(h.Problem, "System credentials or a Monitoring URL") {
		t.Errorf("%+v", h)
	}
}
