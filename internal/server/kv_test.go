package server

import (
	"encoding/json"
	"errors"
	"maps"
	"net/http"
	"net/http/httptest"
	"slices"
	"strconv"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"

	"github.com/CirXe0N/natter/internal/api"
	"github.com/CirXe0N/natter/internal/contexts"
	"github.com/CirXe0N/natter/internal/natstest"
	"github.com/CirXe0N/natter/internal/vault"
)

func TestKV(t *testing.T) {
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
	ctx := t.Context()
	kv, err := js.CreateKeyValue(ctx, jetstream.KeyValueConfig{Bucket: "config", History: 5})
	if err != nil {
		t.Fatal(err)
	}
	r1, _ := kv.PutString(ctx, "app.a", "one")
	r2, _ := kv.PutString(ctx, "app.a", "two")
	if err := kv.Delete(ctx, "app.a"); err != nil {
		t.Fatal(err)
	}
	if _, err := kv.PutString(ctx, "dir/x", "slash"); err != nil {
		t.Fatal(err)
	}
	if _, err := kv.Put(ctx, "empty", nil); err != nil {
		t.Fatal(err)
	}
	if _, err := js.CreateStream(ctx, jetstream.StreamConfig{Name: "ORDERS", Subjects: []string{"orders.>"}}); err != nil {
		t.Fatal(err)
	}

	root := t.TempDir()
	if err := natstest.WriteContext(root, "app", map[string]string{"url": ns.ClientURL(), "user": "app", "password": "app"}); err != nil {
		t.Fatal(err)
	}
	m := contexts.New(root, vault.Open(t.TempDir()))
	t.Cleanup(m.Close)
	h := New(Config{Token: "tok", Port: 1, UI: fstest.MapFS{}, Contexts: m})
	var session *http.Cookie
	var got http.Header // the last response's headers
	call := func(method, target, body string, header ...http.Header) (int, string) {
		r := httptest.NewRequest(method, target, strings.NewReader(body))
		r.Host = "localhost"
		for _, hd := range header {
			maps.Copy(r.Header, hd)
		}
		if session != nil {
			r.AddCookie(session)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if c := w.Result().Cookies(); len(c) > 0 {
			session = c[0]
		}
		got = w.Result().Header
		return w.Code, w.Body.String()
	}
	call("GET", "/launch?token=tok", "")
	if code, body := call("PUT", "/api/contexts/active", `{"source":"cli","name":"app"}`); code != 200 {
		t.Fatalf("connect: %d %s", code, body)
	}
	// Browsing a bucket changes nothing, so all of it works under Read-only mode.
	if code, body := call("PUT", "/api/contexts/cli/app/settings", `{"readOnly":true}`); code != 200 {
		t.Fatalf("read-only: %d %s", code, body)
	}

	want := func(what string, code int, body string, wantCode int, wantBody string) {
		t.Helper()
		if code != wantCode || !strings.Contains(body, wantBody) {
			t.Errorf("%s: %d %q, want %d with %q", what, code, body, wantCode, wantBody)
		}
	}

	code, body := call("GET", "/api/kv", "")
	var buckets []api.KVBucket
	if err := json.Unmarshal([]byte(body), &buckets); code != 200 || err != nil {
		t.Fatalf("buckets: %d %s", code, body)
	}
	if len(buckets) != 1 || buckets[0] != (api.KVBucket{Bucket: "config", Values: 5, History: 5, Bytes: buckets[0].Bytes, Storage: "file", Replicas: 1}) || buckets[0].Bytes == 0 {
		t.Errorf("buckets %+v, want only config, not ORDERS", buckets)
	}

	// The payload viewer always asks for a value's first bytes and learns its size from Content-Range.
	exact := func(what string, code int, body string, wantCode int, wantBody, wantRange string) {
		t.Helper()
		if code != wantCode || body != wantBody || got.Get("Content-Range") != wantRange {
			t.Errorf("%s: %d %q Content-Range %q, want %d %q %q", what, code, body, got.Get("Content-Range"), wantCode, wantBody, wantRange)
		}
	}
	preview := http.Header{"Range": {"bytes=0-65535"}}
	code, body = call("GET", "/api/kv/config/keys/dir/x", "")
	exact("the latest value", code, body, 200, "slash", "")
	code, body = call("GET", "/api/kv/config/keys/dir/x", "", preview)
	exact("a preview of the latest value", code, body, 206, "slash", "bytes 0-4/5")
	code, body = call("GET", "/api/kv/config/keys/app.a?revision="+strconv.FormatUint(r1, 10), "", http.Header{"Range": {"bytes=0-1"}})
	exact("the first bytes of an old revision", code, body, 206, "on", "bytes 0-1/3")
	code, body = call("GET", "/api/kv/config/keys/empty", "", preview)
	exact("a preview of an empty value", code, body, 200, "", "")
	code, body = call("GET", "/api/kv/config/keys/dir%2Fx", "")
	want("value of a key with an escaped slash, as the browser sends it", code, body, 200, "slash")
	code, body = call("GET", "/api/kv/config/keys/app.a?revision="+strconv.FormatUint(r1, 10), "")
	want("an old revision", code, body, 200, "one")
	code, body = call("GET", "/api/kv/config/keys/app.a", "")
	want("a deleted key", code, body, 404, "no value for app.a")
	code, body = call("GET", "/api/kv/config/keys/nope", "")
	want("a missing key", code, body, 404, "no value for nope")
	code, body = call("GET", "/api/kv/nope/keys/app.a", "")
	want("a missing bucket", code, body, 404, "no bucket named nope")
	code, body = call("GET", "/api/kv/config/keys/app.a?revision=x", "")
	want("a bad revision", code, body, 400, "revision")

	code, body = call("GET", "/api/kv/config/history/app.a", "")
	var hist []api.KVEntry
	if err := json.Unmarshal([]byte(body), &hist); code != 200 || err != nil {
		t.Fatalf("history: %d %s", code, body)
	}
	if len(hist) != 3 || hist[0].Revision != r1 || hist[1].Revision != r2 || hist[0].Op != api.KVOpPut || hist[2].Op != api.KVOpDelete || hist[0].Created.IsZero() {
		t.Errorf("history %+v, want put r%d, put r%d, delete", hist, r1, r2)
	}
	code, body = call("GET", "/api/kv/config/history/nope", "")
	want("history of a missing key", code, body, 404, "no value for nope")

	// The live key list, through the real /ws chain.
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	c, _, err := websocket.Dial(ctx, "ws://"+srv.Listener.Addr().String()+"/ws", &websocket.DialOptions{HTTPHeader: http.Header{"Cookie": {session.String()}}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.CloseNow() })
	if err := wsjson.Write(ctx, c, api.ClientFrame{Op: api.ClientOpSub, Topic: api.TopicKV + "config"}); err != nil {
		t.Fatal(err)
	}
	var f api.ServerFrame
	if err := wsjson.Read(ctx, c, &f); err != nil {
		t.Fatal(err)
	}
	if f.Topic != "kv:config" || f.KV == nil || !f.KV.Full {
		t.Fatalf("first kv frame %+v", f)
	}
	var live []string // a full frame lists its keys in no set order
	for _, e := range f.KV.Keys {
		live = append(live, e.Key)
	}
	if slices.Sort(live); !slices.Equal(live, []string{"dir/x", "empty"}) {
		t.Errorf("first kv frame keys %v, want dir/x and empty", live)
	}

	// Put, delete and purge are refused under Read-only mode and work without it.
	for _, m := range []string{"PUT /api/kv/config/keys/m", "DELETE /api/kv/config/keys/m", "POST /api/kv"} {
		meth, path, _ := strings.Cut(m, " ")
		code, body = call(meth, path, "x")
		want(m+" under Read-only", code, body, 403, "")
	}
	if code, body := call("PUT", "/api/contexts/cli/app/settings", `{"readOnly":false}`); code != 200 {
		t.Fatalf("read-only off: %d %s", code, body)
	}
	code, body = call("PUT", "/api/kv/config/keys/dir%2Fm", "\x00bin\xff")
	want("put", code, body, 200, `"revision"`)
	if e, err := kv.Get(ctx, "dir/m"); err != nil || string(e.Value()) != "\x00bin\xff" {
		t.Errorf("put stored %v, %v", e, err)
	}
	call("PUT", "/api/kv/config/keys/dir%2Fm", "two")
	code, body = call("DELETE", "/api/kv/config/keys/dir%2Fm", "")
	want("delete", code, body, 200, "")
	if _, err := kv.Get(ctx, "dir/m"); !errors.Is(err, jetstream.ErrKeyNotFound) {
		t.Errorf("after delete: %v", err)
	}
	if h, _ := kv.History(ctx, "dir/m"); len(h) != 3 {
		t.Errorf("delete kept %d entries, want 2 puts and a marker", len(h))
	}
	code, body = call("DELETE", "/api/kv/config/keys/dir%2Fm?purge=true", "")
	want("purge", code, body, 200, "")
	if h, _ := kv.History(ctx, "dir/m"); len(h) != 1 {
		t.Errorf("purge left %d entries, want the purge marker only", len(h))
	}
	code, body = call("PUT", "/api/kv/config/keys/bad%20key", "x")
	want("an invalid key", code, body, 400, "")
	code, body = call("PUT", "/api/kv/nope/keys/k", "x")
	want("put to a missing bucket", code, body, 404, "no bucket named nope")

	// Create takes nats.go's KeyValueConfig JSON and answers with the new bucket's row.
	fresh := `{"bucket":"fresh","description":"for tests","history":5,"ttl":60000000000,"max_value_size":1024,"max_bytes":1048576,"storage":"file","num_replicas":1,"compression":true}`
	code, body = call("POST", "/api/kv", fresh)
	var made api.KVBucket
	if err := json.Unmarshal([]byte(body), &made); code != 200 || err != nil {
		t.Fatalf("create: %d %s", code, body)
	}
	if made != (api.KVBucket{Bucket: "fresh", History: 5, TTL: 60, Storage: "file", Replicas: 1}) {
		t.Errorf("created %+v", made)
	}
	if st, err := js.KeyValue(ctx, "fresh"); err != nil {
		t.Errorf("open created bucket: %v", err)
	} else if s, _ := st.Status(ctx); s.Config().Description != "for tests" || s.Config().MaxValueSize != 1024 || s.Config().MaxBytes != 1048576 || !s.IsCompressed() {
		t.Errorf("created config %+v", s.Config())
	}
	// The same config again would be a no-op on the server, so create refuses a taken name itself.
	code, body = call("POST", "/api/kv", fresh)
	want("create a bucket that exists", code, body, 400, `"field":"bucket"`)
	want("create a bucket that exists", code, body, 400, "already exists")
	code, body = call("POST", "/api/kv", `{"bucket":"config"}`)
	want("create over a bucket with another config", code, body, 400, `"field":"bucket"`)
	code, body = call("POST", "/api/kv", `{"bucket":"bad name"}`)
	want("an invalid bucket name", code, body, 400, `"field":"bucket"`)
	code, body = call("POST", "/api/kv", `{"bucket":"deep","history":65}`)
	want("too much history", code, body, 400, `"field":"history"`)
	code, body = call("POST", "/api/kv", `{"bucket":"many","num_replicas":3}`)
	want("a server refusal", code, body, 400, `"field":"num_replicas"`)
	code, body = call("POST", "/api/kv", `{"bucket":"typo","histroy":5}`)
	want("an unknown key", code, body, 400, "histroy")
}
