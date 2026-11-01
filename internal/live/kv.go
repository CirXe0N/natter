package live

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/nats-io/nats.go/jetstream"

	"github.com/CirXe0N/natter/internal/api"
	"github.com/CirXe0N/natter/internal/contexts"
)

// kvFlush batches key changes into one frame; kvRetry spaces watch attempts
// after a failure.
const (
	kvFlush = 250 * time.Millisecond
	kvRetry = 2 * time.Second
)

// KVKeys produces api.TopicKV plus a bucket: the bucket's keys in the active
// Context, from WatchAll with MetaOnly, so values never cross the wire. After
// the initial load (the watcher's nil) it sends a full frame, then every
// kvFlush the keys changed since that full frame. The changed set only grows,
// so a newer update holds everything an older one did and the hub may drop
// the older one. Once half the keys have changed a full frame starts afresh.
// shortcut: the whole key list is held and sent, add a server-side prefix to
// the topic when buckets of a million keys show up.
type KVKeys struct {
	active func() *contexts.Conn
	bucket string

	mu      sync.Mutex
	loaded  bool
	problem string
	keys    map[string]api.KVEntry // latest revision per key; deletes are kept until the next full frame
	changed map[string]bool        // keys changed since the last full frame
	rev     uint64
}

// NewKVKeys watches bucket in whatever Context active returns, and starts
// over when that changes.
func NewKVKeys(active func() *contexts.Conn, bucket string) *KVKeys {
	return &KVKeys{active: active, bucket: bucket}
}

func (k *KVKeys) Run(ctx context.Context, emit func(frame []byte, snapshot bool)) {
	for ctx.Err() == nil {
		err := k.watch(ctx, emit)
		if err == nil {
			continue // the active Context changed
		}
		k.mu.Lock()
		changed := k.problem != err.Error()
		k.reset()
		k.problem = err.Error()
		f := k.frame(true)
		k.mu.Unlock()
		if changed {
			emit(f, true)
		}
		select {
		case <-ctx.Done():
		case <-time.After(kvRetry):
		}
	}
}

// Snapshot is the whole list, the problem, or nil while the first load runs.
func (k *KVKeys) Snapshot() []byte {
	k.mu.Lock()
	defer k.mu.Unlock()
	if !k.loaded && k.problem == "" {
		return nil
	}
	return k.frame(true)
}

// watch runs one watcher until ctx ends or the active Context changes (nil),
// or until it fails.
func (k *KVKeys) watch(ctx context.Context, emit func([]byte, bool)) error {
	a := k.active()
	switch {
	case a == nil:
		return errors.New("No Context is active. Pick one on the Contexts screen.")
	case a.NC == nil:
		return fmt.Errorf("%s is not connected (%s).", a.Context.Name, a.Status)
	case a.JS == nil:
		return fmt.Errorf("JetStream is not available to %s's account.", a.Context.Name)
	}
	kv, err := a.JS.KeyValue(ctx, k.bucket)
	if errors.Is(err, jetstream.ErrBucketNotFound) || errors.Is(err, jetstream.ErrInvalidBucketName) {
		return fmt.Errorf("%s has no bucket named %s.", a.Context.Name, k.bucket)
	}
	if err != nil {
		return err
	}
	w, err := kv.WatchAll(ctx, jetstream.MetaOnly())
	if err != nil {
		return err
	}
	defer w.Stop()
	k.mu.Lock()
	k.keys, k.changed, k.rev = map[string]api.KVEntry{}, map[string]bool{}, 0
	k.mu.Unlock()

	tick := time.NewTicker(kvFlush)
	defer tick.Stop()
	for {
		var f []byte
		full := false
		select {
		case <-ctx.Done():
			return nil
		case e, ok := <-w.Updates():
			if !ok {
				if k.active() != a {
					return nil
				}
				return fmt.Errorf("The watch on bucket %s stopped.", k.bucket)
			}
			k.mu.Lock()
			if e == nil {
				k.loaded, k.problem = true, ""
				f, full = k.full(), true
			} else {
				k.apply(e)
			}
			k.mu.Unlock()
		case <-tick.C:
			if k.active() != a {
				return nil
			}
			k.mu.Lock()
			if k.loaded && len(k.changed) > 0 {
				if full = 2*len(k.changed) > len(k.keys); full {
					f = k.full()
				} else {
					f = k.frame(false)
				}
			}
			k.mu.Unlock()
		}
		if f != nil {
			emit(f, full)
		}
	}
}

var kvOps = map[jetstream.KeyValueOp]api.KVOp{jetstream.KeyValuePut: api.KVOpPut, jetstream.KeyValueDelete: api.KVOpDelete, jetstream.KeyValuePurge: api.KVOpPurge}

// KVEntry is e without its value.
func KVEntry(e jetstream.KeyValueEntry) api.KVEntry {
	return api.KVEntry{Key: e.Key(), Revision: e.Revision(), Op: kvOps[e.Operation()], Created: e.Created()}
}

// apply runs with k.mu held.
func (k *KVKeys) apply(e jetstream.KeyValueEntry) {
	k.keys[e.Key()] = KVEntry(e)
	k.rev = max(k.rev, e.Revision())
	if k.loaded {
		k.changed[e.Key()] = true
	}
}

// full drops deleted keys and starts a new changed set. It runs with k.mu held.
func (k *KVKeys) full() []byte {
	for key, e := range k.keys {
		if e.Op != api.KVOpPut {
			delete(k.keys, key)
		}
	}
	clear(k.changed)
	return k.frame(true)
}

// reset forgets the list. It runs with k.mu held.
func (k *KVKeys) reset() {
	k.loaded, k.keys, k.changed, k.rev = false, nil, nil, 0
}

// frame encodes every live key, or the changed ones. It runs with k.mu held.
func (k *KVKeys) frame(full bool) []byte {
	out := api.KVKeys{Full: full, Rev: k.rev, Keys: []api.KVEntry{}, Problem: k.problem}
	if full {
		for _, e := range k.keys {
			if e.Op == api.KVOpPut {
				out.Keys = append(out.Keys, e)
			}
		}
	} else {
		for key := range k.changed {
			out.Keys = append(out.Keys, k.keys[key])
		}
	}
	b, _ := json.Marshal(api.ServerFrame{Topic: api.TopicKV + api.Topic(k.bucket), KV: &out})
	return b
}
