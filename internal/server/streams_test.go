package server_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"

	"github.com/CirXe0N/natter/internal/api"
	"github.com/CirXe0N/natter/internal/contexts"
	"github.com/CirXe0N/natter/internal/natstest"
	"github.com/CirXe0N/natter/internal/server"
	"github.com/CirXe0N/natter/internal/vault"
)

func TestStreams(t *testing.T) {
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
	for _, subj := range []string{"orders.eu.new", "orders.eu.new", "orders.us.paid"} {
		if _, err := js.Publish(ctx, subj, []byte("x")); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := js.CreateStream(ctx, jetstream.StreamConfig{Name: "ORDERS_COPY", Mirror: &jetstream.StreamSource{Name: "ORDERS"}}); err != nil {
		t.Fatal(err)
	}
	if _, err := js.CreateKeyValue(ctx, jetstream.KeyValueConfig{Bucket: "config"}); err != nil {
		t.Fatal(err)
	}
	if _, err := js.CreateObjectStore(ctx, jetstream.ObjectStoreConfig{Bucket: "files"}); err != nil {
		t.Fatal(err)
	}
	// More than one 256-stream page of $JS.API.STREAM.LIST.
	const extra = 300
	for i := range extra {
		if _, err := js.CreateStream(ctx, jetstream.StreamConfig{Name: fmt.Sprintf("S%03d", i), Subjects: []string{fmt.Sprintf("s.%d", i)}, Storage: jetstream.MemoryStorage}); err != nil {
			t.Fatal(err)
		}
	}

	root := t.TempDir()
	for name, user := range map[string]string{"app": "app", "nojs": "nojs"} {
		if err := natstest.WriteContext(root, name, map[string]string{"url": ns.ClientURL(), "user": user, "password": user}); err != nil {
			t.Fatal(err)
		}
	}
	m := contexts.New(root, vault.Open(t.TempDir()))
	t.Cleanup(m.Close)
	h := server.New(server.Config{Token: token, Port: port, UI: ui, Contexts: m})
	c := launch(t, h)
	get := func(path string, want int, v any) string {
		t.Helper()
		w := do(h, "GET", path, func(r *http.Request) { r.AddCookie(c) })
		if w.Code != want {
			t.Fatalf("GET %s: %d %s", path, w.Code, w.Body)
		}
		if v != nil {
			if err := json.Unmarshal(w.Body.Bytes(), v); err != nil {
				t.Fatal(err)
			}
		}
		return w.Body.String()
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

	if body := get("/api/streams", http.StatusConflict, nil); !strings.Contains(body, "No Context") {
		t.Fatalf("no Context: %s", body)
	}
	use("nojs")
	if body := get("/api/streams", http.StatusConflict, nil); !strings.Contains(body, "JetStream is not available") {
		t.Fatalf("nojs: %s", body)
	}
	use("app")

	var list api.StreamList
	get("/api/streams", http.StatusOK, &list)
	byName := map[string]api.StreamSummary{}
	for _, s := range list.Streams {
		byName[s.Name] = s
	}
	if len(list.Streams) != extra+4 || len(list.Offline) != 0 {
		t.Fatalf("listed %d streams (want %d), offline %v", len(list.Streams), extra+4, list.Offline)
	}
	o := byName["ORDERS"]
	if o.Kind != api.StreamKindStream || o.Msgs != 3 || o.Storage != "file" || o.Replicas != 1 || o.Health != api.StreamHealthOK || o.FirstTime == nil || o.LastTime == nil {
		t.Fatalf("ORDERS: %+v", o)
	}
	if byName["S299"].Storage != "memory" || byName["S299"].FirstTime != nil {
		t.Fatalf("S299: %+v", byName["S299"])
	}
	if byName["KV_config"].Kind != api.StreamKindKV || byName["OBJ_files"].Kind != api.StreamKindObject {
		t.Fatalf("kinds: %+v %+v", byName["KV_config"], byName["OBJ_files"])
	}

	get("/api/streams?subject=orders.eu.*", http.StatusOK, &list)
	if len(list.Streams) != 1 || list.Streams[0].Name != "ORDERS" {
		t.Fatalf("subject filter: %+v", list.Streams)
	}

	var d api.StreamDetail
	get("/api/streams/ORDERS", http.StatusOK, &d)
	var cfg struct {
		Name     string   `json:"name"`
		Subjects []string `json:"subjects"`
	}
	if err := json.Unmarshal(d.Config, &cfg); err != nil || cfg.Name != "ORDERS" || cfg.Subjects[0] != "orders.>" {
		t.Fatalf("config %s: %v", d.Config, err)
	}
	if d.FirstSeq != 1 || d.LastSeq != 3 || d.NumSubjects != 2 || d.MaxPayload != nc.MaxPayload() || len(d.ReplicaState) != 1 || !d.ReplicaState[0].Leader {
		t.Fatalf("ORDERS detail: %+v", d)
	}

	get("/api/streams/ORDERS_COPY", http.StatusOK, &d)
	if d.Mirror == nil || d.Mirror.Name != "ORDERS" || d.Mirror.Error != "" {
		t.Fatalf("mirror: %+v", d.Mirror)
	}

	var subs api.StreamSubjects
	get("/api/streams/ORDERS/subjects", http.StatusOK, &subs)
	if subs.Filter != ">" || subs.Truncated || len(subs.Subjects) != 2 || subs.Subjects["orders.eu.new"] != 2 || subs.Subjects["orders.us.paid"] != 1 {
		t.Fatalf("subjects: %+v", subs)
	}
	subs = api.StreamSubjects{}
	get("/api/streams/ORDERS/subjects?filter=orders.us.>", http.StatusOK, &subs)
	if len(subs.Subjects) != 1 || subs.Subjects["orders.us.paid"] != 1 {
		t.Fatalf("filtered subjects: %+v", subs)
	}

	get("/api/streams/NOPE", http.StatusNotFound, nil)
	get("/api/streams/NOPE/subjects", http.StatusNotFound, nil)
	get("/api/streams/a.b", http.StatusNotFound, nil)
	if body := get("/api/streams", http.StatusOK, nil); bytes.Contains([]byte(body), []byte(`"offline":null`)) {
		t.Fatal("offline must be an object")
	}
}
