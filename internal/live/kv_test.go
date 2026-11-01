package live

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"

	"github.com/CirXe0N/natter/internal/api"
	"github.com/CirXe0N/natter/internal/contexts"
	"github.com/CirXe0N/natter/internal/natstest"
	"github.com/CirXe0N/natter/internal/vault"
)

func TestKVKeysWatch(t *testing.T) {
	ns, err := natstest.Start(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(ns.Shutdown)
	root := t.TempDir()
	if err := natstest.WriteContext(root, "app", map[string]string{"url": ns.ClientURL(), "user": "app", "password": "app"}); err != nil {
		t.Fatal(err)
	}
	m := contexts.New(root, vault.Open(t.TempDir()))
	t.Cleanup(m.Close)
	if err := m.Activate(t.Context(), api.Ref{Source: api.SourceCLI, Name: "app"}); err != nil {
		t.Fatal(err)
	}

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
	keys := []string{"app.a", "app.b", "gone"}
	for i := range 8 {
		keys = append(keys, fmt.Sprintf("other.%d", i)) // enough keys that two changes are sent as an update
	}
	for _, k := range keys {
		if _, err := kv.PutString(ctx, k, "v"); err != nil {
			t.Fatal(err)
		}
	}
	if err := kv.Delete(ctx, "gone"); err != nil {
		t.Fatal(err)
	}

	start := func(bucket string) (*KVKeys, <-chan api.KVKeys) {
		p := NewKVKeys(m.Active, bucket)
		frames := make(chan api.KVKeys, 100)
		rctx, cancel := context.WithCancel(context.Background())
		t.Cleanup(cancel)
		go p.Run(rctx, func(b []byte, full bool) {
			var f api.ServerFrame
			if err := json.Unmarshal(b, &f); err != nil || f.Topic != api.TopicKV+api.Topic(bucket) || f.KV == nil || f.KV.Full != full {
				t.Errorf("frame %s (snapshot %v)", b, full)
				return
			}
			frames <- *f.KV
		})
		return p, frames
	}
	next := func(frames <-chan api.KVKeys) api.KVKeys {
		t.Helper()
		select {
		case f := <-frames:
			return f
		case <-time.After(5 * time.Second):
			t.Fatal("no frame")
			return api.KVKeys{}
		}
	}
	ops := func(f api.KVKeys) map[string]api.KVOp {
		out := map[string]api.KVOp{}
		for _, e := range f.Keys {
			out[e.Key] = e.Op
		}
		return out
	}

	p, frames := start("config")
	if p.Snapshot() != nil {
		t.Error("a snapshot before the initial load")
	}
	first := next(frames)
	if !first.Full || len(first.Keys) != 10 || ops(first)["app.a"] != api.KVOpPut || ops(first)["app.b"] != api.KVOpPut {
		t.Fatalf("initial load %+v, want 10 keys without the deleted one", first)
	}
	if p.Snapshot() == nil {
		t.Error("no snapshot after the initial load")
	}

	if _, err := kv.PutString(ctx, "app.c", "new"); err != nil {
		t.Fatal(err)
	}
	if err := kv.Delete(ctx, "app.a"); err != nil {
		t.Fatal(err)
	}
	// Changes since the last full frame accumulate; wait for both.
	var got map[string]api.KVOp
	for got["app.c"] != api.KVOpPut || got["app.a"] != api.KVOpDelete {
		f := next(frames)
		if f.Full {
			t.Fatalf("full frame %+v for two changes to an 11-key bucket", f)
		}
		if f.Rev < first.Rev {
			t.Errorf("rev went back from %d to %d", first.Rev, f.Rev)
		}
		got = ops(f)
	}
	if _, ok := got["app.b"]; ok {
		t.Errorf("unchanged app.b in an update: %v", got)
	}

	_, missing := start("nope")
	if f := next(missing); !f.Full || !strings.Contains(f.Problem, "no bucket named nope") {
		t.Errorf("missing bucket %+v", f)
	}
}
