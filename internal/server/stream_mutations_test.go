package server_test

import (
	"context"
	"encoding/json"
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

func TestStreamMutations(t *testing.T) {
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

	root := t.TempDir()
	if err := natstest.WriteContext(root, "app", map[string]string{"url": ns.ClientURL(), "user": "app", "password": "app"}); err != nil {
		t.Fatal(err)
	}
	m := contexts.New(root, vault.Open(t.TempDir()))
	t.Cleanup(m.Close)
	h := server.New(server.Config{Token: token, Port: port, UI: ui, Contexts: m})
	c := launch(t, h)
	send := func(method, path, body string, want int) string {
		t.Helper()
		w := do(h, method, path, func(r *http.Request) {
			r.AddCookie(c)
			r.Body = io.NopCloser(strings.NewReader(body))
		})
		if w.Code != want {
			t.Fatalf("%s %s %s: %d %s (want %d)", method, path, body, w.Code, w.Body, want)
		}
		return w.Body.String()
	}
	send("PUT", "/api/contexts/active", `{"source":"cli","name":"app"}`, 200)

	// Create.
	var sum api.StreamSummary
	if err := json.Unmarshal([]byte(send("POST", "/api/streams", `{"name":"JOBS","subjects":["jobs.>"],"storage":"memory","retention":"limits","max_age":3600000000000}`, 200)), &sum); err != nil {
		t.Fatal(err)
	}
	if sum.Name != "JOBS" || sum.Storage != "memory" {
		t.Fatalf("created: %+v", sum)
	}
	st, err := js.Stream(ctx, "JOBS")
	if err != nil {
		t.Fatal(err)
	}
	if cfg := st.CachedInfo().Config; cfg.MaxAge.Hours() != 1 || cfg.Subjects[0] != "jobs.>" {
		t.Fatalf("server config: %+v", cfg)
	}

	// Refusals name the field they belong to.
	for _, tc := range []struct{ method, path, body, field string }{
		{"POST", "/api/streams", `{"name":"JOBS","subjects":["other.>"],"storage":"memory"}`, "name"},
		{"POST", "/api/streams", `{"name":"CLASH","subjects":["jobs.x"],"storage":"memory"}`, "subjects"},
		{"POST", "/api/streams", `{"name":"BAD","subjects":["bad.>"],"storage":"memory","num_replicas":9}`, "num_replicas"},
		{"POST", "/api/streams", `{"name":"BAD NAME","subjects":["bad.>"]}`, "name"},
		{"PUT", "/api/streams/JOBS", `{"name":"JOBS","subjects":["jobs.>"],"storage":"file"}`, "storage"},
		{"PUT", "/api/streams/JOBS", `{"name":"RENAMED","subjects":["jobs.>"],"storage":"memory"}`, "name"},
	} {
		var fe api.FieldError
		if err := json.Unmarshal([]byte(send(tc.method, tc.path, tc.body, 400)), &fe); err != nil || fe.Field != tc.field || fe.Error == "" {
			t.Errorf("%s %s: field %q error %q (want field %q): %v", tc.method, tc.body, fe.Field, fe.Error, tc.field, err)
		}
	}
	send("POST", "/api/streams", `{"nope":1}`, 400)
	send("PUT", "/api/streams/MISSING", `{"name":"MISSING","subjects":["m.>"]}`, 404)

	// Update.
	send("PUT", "/api/streams/JOBS", `{"name":"JOBS","description":"work","subjects":["jobs.>","job2.>"],"storage":"memory","max_msgs":50}`, 200)
	if cfg := mustInfo(t, js, "JOBS").Config; cfg.Description != "work" || cfg.MaxMsgs != 50 || len(cfg.Subjects) != 2 {
		t.Fatalf("updated: %+v", cfg)
	}

	// The edit form sends the server's own config back; an unchanged edit must be accepted.
	var d api.StreamDetail
	if err := json.Unmarshal([]byte(send("GET", "/api/streams/JOBS", ``, 200)), &d); err != nil {
		t.Fatal(err)
	}
	send("PUT", "/api/streams/JOBS", string(d.Config), 200)

	// Purge variants.
	publish := func(n int, subj string) {
		for range n {
			if _, err := js.Publish(ctx, subj, []byte("x")); err != nil {
				t.Fatal(err)
			}
		}
	}
	msgs := func() uint64 { return mustInfo(t, js, "JOBS").State.Msgs }
	purge := func(body string, want uint64) {
		t.Helper()
		var p api.StreamPurged
		if err := json.Unmarshal([]byte(send("POST", "/api/streams/JOBS/purge", body, 200)), &p); err != nil || p.Purged != want {
			t.Fatalf("purge %s: %+v (want %d): %v", body, p, want, err)
		}
	}
	publish(4, "jobs.a")
	publish(3, "jobs.b")
	send("POST", "/api/streams/JOBS/purge", `{"subject":"jobs.a"}`, 400) // no typed confirmation
	send("POST", "/api/streams/JOBS/purge", `{"subject":"jobs.a","confirm":"jobs"}`, 400)
	if msgs() != 7 {
		t.Fatalf("an unconfirmed purge removed messages: %d left", msgs())
	}
	purge(`{"subject":"jobs.a","confirm":"JOBS"}`, 4)
	publish(5, "jobs.b") // 8 on jobs.b
	purge(`{"keep":2,"confirm":"JOBS"}`, 6)
	if msgs() != 2 {
		t.Fatalf("keep: %d left", msgs())
	}
	last := mustInfo(t, js, "JOBS").State.LastSeq
	publish(3, "jobs.b")
	purge(`{"sequence":`+itoa(last+2)+`,"confirm":"JOBS"}`, 3) // up to but not including last+2: two old plus last+1
	purge(`{"confirm":"JOBS"}`, 2)
	send("POST", "/api/streams/JOBS/purge", `{"keep":1,"sequence":5,"confirm":"JOBS"}`, 400)
	send("POST", "/api/streams/MISSING/purge", `{"confirm":"MISSING"}`, 404)

	// Read-only refuses all four.
	send("PUT", "/api/contexts/cli/app/settings", `{"readOnly":true}`, 200)
	send("POST", "/api/streams", `{"name":"X","subjects":["x.>"]}`, 403)
	send("PUT", "/api/streams/JOBS", `{"name":"JOBS","subjects":["jobs.>"]}`, 403)
	send("POST", "/api/streams/JOBS/purge", `{"confirm":"JOBS"}`, 403)
	send("DELETE", "/api/streams/JOBS", `{"confirm":"JOBS"}`, 403)
	send("PUT", "/api/contexts/cli/app/settings", `{"readOnly":false}`, 200)

	// Delete.
	send("DELETE", "/api/streams/JOBS", `{}`, 400)
	if _, err := js.Stream(ctx, "JOBS"); err != nil {
		t.Fatal("an unconfirmed delete removed the stream")
	}
	send("DELETE", "/api/streams/JOBS", `{"confirm":"JOBS"}`, 200)
	if _, err := js.Stream(ctx, "JOBS"); err == nil {
		t.Fatal("stream survived delete")
	}
	send("DELETE", "/api/streams/JOBS", `{"confirm":"JOBS"}`, 404)
}

func mustInfo(t *testing.T, js jetstream.JetStream, name string) *jetstream.StreamInfo {
	t.Helper()
	st, err := js.Stream(context.Background(), name)
	if err != nil {
		t.Fatal(err)
	}
	info, err := st.Info(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return info
}

func itoa(n uint64) string { b, _ := json.Marshal(n); return string(b) }
