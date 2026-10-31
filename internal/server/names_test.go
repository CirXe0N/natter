package server_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"

	"github.com/CirXe0N/natter/internal/api"
	"github.com/CirXe0N/natter/internal/contexts"
	"github.com/CirXe0N/natter/internal/natstest"
	"github.com/CirXe0N/natter/internal/server"
)

func TestJetStreamNames(t *testing.T) {
	ns, err := natstest.Start(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(ns.Shutdown)
	nc, err := nats.Connect(ns.ClientURL(), nats.UserInfo("app", "app"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(nc.Close)
	js, _ := jetstream.New(nc)
	ctx := context.Background()
	if _, err := js.CreateStream(ctx, jetstream.StreamConfig{Name: "ORDERS", Subjects: []string{"orders.>"}}); err != nil {
		t.Fatal(err)
	}
	if _, err := js.CreateKeyValue(ctx, jetstream.KeyValueConfig{Bucket: "config"}); err != nil {
		t.Fatal(err)
	}

	root := t.TempDir()
	for name, user := range map[string]string{"app": "app", "nojs": "nojs"} {
		if err := natstest.WriteContext(root, name, map[string]string{"url": ns.ClientURL(), "user": user, "password": user}); err != nil {
			t.Fatal(err)
		}
	}
	m := contexts.New(root)
	t.Cleanup(m.Close)
	h := server.New(server.Config{Token: token, Port: port, UI: ui, Contexts: m})
	c := launch(t, h)
	get := func() api.JetStreamNames {
		w := do(h, "GET", "/api/jetstream/names", func(r *http.Request) { r.AddCookie(c) })
		var n api.JetStreamNames
		if w.Code != http.StatusOK || json.Unmarshal(w.Body.Bytes(), &n) != nil {
			t.Fatalf("GET names: %d %s", w.Code, w.Body)
		}
		return n
	}
	use := func(name string) {
		w := do(h, "PUT", "/api/contexts/active", func(r *http.Request) {
			r.AddCookie(c)
			r.Body = io.NopCloser(strings.NewReader(`{"source":"cli","name":"` + name + `"}`))
		})
		if w.Code != http.StatusOK {
			t.Fatalf("activate %s: %d %s", name, w.Code, w.Body)
		}
	}

	if n := get(); len(n.Streams)+len(n.Buckets) != 0 {
		t.Fatalf("before any Context: %+v", n)
	}
	use("app")
	if n := get(); !slices.Equal(n.Streams, []string{"ORDERS"}) || !slices.Equal(n.Buckets, []string{"config"}) {
		t.Fatalf("app: %+v", n)
	}
	use("nojs")
	if n := get(); len(n.Streams)+len(n.Buckets) != 0 {
		t.Fatalf("nojs: %+v", n)
	}
}
