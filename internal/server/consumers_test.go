package server_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"

	"github.com/CirXe0N/natter/internal/api"
	"github.com/CirXe0N/natter/internal/contexts"
	"github.com/CirXe0N/natter/internal/natstest"
	"github.com/CirXe0N/natter/internal/server"
	"github.com/CirXe0N/natter/internal/vault"
)

func TestConsumers(t *testing.T) {
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
	for range 5 {
		if _, err := js.Publish(ctx, "orders.eu.new", []byte("x")); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := js.CreateOrUpdateConsumer(ctx, "ORDERS", jetstream.ConsumerConfig{Durable: "billing", AckPolicy: jetstream.AckExplicitPolicy, FilterSubject: "orders.eu.>"}); err != nil {
		t.Fatal(err)
	}
	if _, err := js.CreateOrUpdateConsumer(ctx, "ORDERS", jetstream.ConsumerConfig{Name: "natter_browse_1", AckPolicy: jetstream.AckNonePolicy, InactiveThreshold: time.Minute}); err != nil {
		t.Fatal(err)
	}

	root := t.TempDir()
	if err := natstest.WriteContext(root, "app", map[string]string{"url": ns.ClientURL(), "user": "app", "password": "app"}); err != nil {
		t.Fatal(err)
	}
	m := contexts.New(root, vault.Open(t.TempDir()))
	t.Cleanup(m.Close)
	h := server.New(server.Config{Token: token, Port: port, UI: ui, Contexts: m})
	c := launch(t, h)
	call := func(method, path, body string, want int, v any) string {
		t.Helper()
		w := do(h, method, path, func(r *http.Request) {
			r.AddCookie(c)
			if body != "" {
				r.Body = io.NopCloser(strings.NewReader(body))
			}
		})
		if w.Code != want {
			t.Fatalf("%s %s: %d %s, want %d", method, path, w.Code, w.Body, want)
		}
		if v != nil {
			if err := json.Unmarshal(w.Body.Bytes(), v); err != nil {
				t.Fatal(err)
			}
		}
		return w.Body.String()
	}
	call("GET", "/api/streams/ORDERS/consumers", "", http.StatusConflict, nil)
	call("PUT", "/api/contexts/active", `{"source":"cli","name":"app"}`, 200, nil)

	var list api.ConsumerList
	call("GET", "/api/streams/ORDERS/consumers", "", 200, &list)
	by := map[string]api.ConsumerSummary{}
	for _, cs := range list.Consumers {
		by[cs.Name] = cs
	}
	b, n := by["billing"], by["natter_browse_1"]
	if len(list.Consumers) != 2 || b.Natter || !n.Natter || !b.Durable || n.Durable || b.AckPolicy != "explicit" || n.AckPolicy != "none" ||
		b.Pending != 5 || len(b.Filter) != 1 || b.Filter[0] != "orders.eu.>" || b.Paused || b.Push {
		t.Fatalf("consumers: %+v", list.Consumers)
	}
	call("GET", "/api/streams/NOPE/consumers/billing", "", http.StatusNotFound, nil)
	call("GET", "/api/streams/ORDERS/consumers/NOPE", "", http.StatusNotFound, nil)
	call("GET", "/api/streams/ORDERS/consumers/bad.name", "", http.StatusNotFound, nil)

	var d api.ConsumerDetail
	call("GET", "/api/streams/ORDERS/consumers/billing", "", 200, &d)
	var cfg struct {
		Durable string `json:"durable_name"`
	}
	if err := json.Unmarshal(d.Config, &cfg); err != nil || cfg.Durable != "billing" || d.Stream != "ORDERS" {
		t.Fatalf("detail %+v: %v", d, err)
	}

	const base = "/api/streams/ORDERS/consumers/billing"
	call("PUT", base+"/pause", `{"seconds":0}`, http.StatusBadRequest, nil)
	var s api.ConsumerSummary
	call("PUT", base+"/pause", `{"seconds":3600}`, 200, &s)
	if !s.Paused || s.PauseUntil == nil || time.Until(*s.PauseUntil) < 59*time.Minute {
		t.Fatalf("paused: %+v", s)
	}
	call("GET", "/api/streams/ORDERS/consumers", "", 200, &list)
	for _, cs := range list.Consumers {
		if cs.Name == "billing" && !cs.Paused {
			t.Fatal("list does not show the pause")
		}
	}
	call("DELETE", base+"/pause", "", 200, &s)
	if s.Paused {
		t.Fatalf("resumed: %+v", s)
	}

	// Read-only mode refuses all three changes and still allows reading.
	call("PUT", "/api/contexts/cli/app/settings", `{"readOnly":true}`, 200, nil)
	call("PUT", base+"/pause", `{"seconds":60}`, http.StatusForbidden, nil)
	call("DELETE", base+"/pause", "", http.StatusForbidden, nil)
	call("DELETE", base, "", http.StatusForbidden, nil)
	call("GET", base, "", 200, nil)
	call("PUT", "/api/contexts/cli/app/settings", `{}`, 200, nil)

	call("DELETE", base, "", 200, nil)
	call("GET", base, "", http.StatusNotFound, nil)
	call("GET", "/api/streams/ORDERS/consumers", "", 200, &list)
	if len(list.Consumers) != 1 || list.Consumers[0].Name != "natter_browse_1" {
		t.Fatalf("after delete: %+v", list.Consumers)
	}
}
