package server

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"slices"
	"strconv"
	"strings"

	"github.com/nats-io/nats.go/jetstream"

	"github.com/CirXe0N/natter/internal/api"
	"github.com/CirXe0N/natter/internal/contexts"
	"github.com/CirXe0N/natter/internal/live"
)

// The live key list is the "kv:<bucket>" topic on /ws. Values and history are
// fetched one key at a time, on click.
func init() {
	routes = append(routes,
		route{pattern: "GET /api/kv", handle: (*server).listBuckets},
		route{pattern: "GET /api/kv/{bucket}", handle: (*server).bucketConfig},
		route{pattern: "GET /api/kv/{bucket}/keys/{key...}", handle: (*server).kvValue},
		route{pattern: "GET /api/kv/{bucket}/history/{key...}", handle: (*server).kvHistory},
		// No allowReadOnly on these: Read-only mode refuses them.
		route{pattern: "POST /api/kv", handle: (*server).createBucket},
		route{pattern: "PUT /api/kv/{bucket}", handle: (*server).updateBucket},
		route{pattern: "DELETE /api/kv/{bucket}", handle: (*server).deleteBucket},
		route{pattern: "PUT /api/kv/{bucket}/keys/{key...}", handle: (*server).kvPut},
		route{pattern: "DELETE /api/kv/{bucket}/keys/{key...}", handle: (*server).kvDelete},
	)
}

// listBuckets lists the streams named KV_* through nats.go's KeyValueStores.
func (s *server) listBuckets(w http.ResponseWriter, r *http.Request) {
	a := s.jetStream(w)
	if a == nil {
		return
	}
	l := a.JS.KeyValueStores(r.Context())
	out := []api.KVBucket{}
	for st := range l.Status() {
		out = append(out, bucketRow(st))
	}
	if err := l.Error(); err != nil {
		writeError(w, err)
		return
	}
	slices.SortFunc(out, func(x, y api.KVBucket) int { return strings.Compare(x.Bucket, y.Bucket) })
	writeJSON(w, out)
}

func bucketRow(st jetstream.KeyValueStatus) api.KVBucket {
	cfg := st.Config()
	return api.KVBucket{
		Bucket: st.Bucket(), Values: st.Values(), History: st.History(), TTL: int64(st.TTL().Seconds()),
		Bytes: st.Bytes(), Storage: strings.ToLower(cfg.Storage.String()), Replicas: cfg.Replicas,
	}
}

// createBucket makes a bucket from nats.go's KeyValueConfig JSON. A refusal
// names the config key it is about, as for streams.
func (s *server) createBucket(w http.ResponseWriter, r *http.Request) {
	a := s.jetStream(w)
	if a == nil {
		return
	}
	cfg, ok := decodeBucket(w, r)
	if !ok {
		return
	}
	// The server takes a create with an existing bucket's exact config as a no-op, so check first.
	if _, err := a.JS.KeyValue(r.Context(), cfg.Bucket); err == nil {
		writeFieldError(w, fmt.Errorf("A bucket named %s already exists.", cfg.Bucket), "bucket")
		return
	}
	kv, err := a.JS.CreateKeyValue(r.Context(), cfg)
	switch {
	case errors.Is(err, jetstream.ErrBucketExists):
		writeFieldError(w, fmt.Errorf("A bucket named %s already exists.", cfg.Bucket), "bucket")
		return
	case errors.Is(err, jetstream.ErrInvalidBucketName):
		writeFieldError(w, errors.New("A bucket name is letters, numbers, - and _."), "bucket")
		return
	case err != nil:
		writeBucketError(w, err)
		return
	}
	writeBucketRow(w, r, kv)
}

// bucketConfig sends the bucket's config in the shape create and update take, for the edit form.
func (s *server) bucketConfig(w http.ResponseWriter, r *http.Request) {
	_, kv := s.bucket(w, r)
	if kv == nil {
		return
	}
	st, err := kv.Status(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, st.Config())
}

// updateBucket replaces the bucket's config. The server refuses to change its storage.
func (s *server) updateBucket(w http.ResponseWriter, r *http.Request) {
	a := s.jetStream(w)
	if a == nil {
		return
	}
	cfg, ok := decodeBucket(w, r)
	if !ok {
		return
	}
	if cfg.Bucket != r.PathValue("bucket") {
		writeFieldError(w, errors.New("A bucket cannot be renamed."), "bucket")
		return
	}
	kv, err := a.JS.UpdateKeyValue(r.Context(), cfg)
	switch {
	case errors.Is(err, jetstream.ErrBucketNotFound):
		writeKVError(w, a, r, err)
		return
	case err != nil:
		writeBucketError(w, err)
		return
	}
	writeBucketRow(w, r, kv)
}

// deleteBucket removes the bucket and every value in it, once the body repeats its name.
func (s *server) deleteBucket(w http.ResponseWriter, r *http.Request) {
	var body api.StreamDelete
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBody)).Decode(&body); err != nil {
		http.Error(w, "The delete request is not valid JSON.", http.StatusBadRequest)
		return
	}
	a := s.jetStream(w)
	if a == nil || !confirmed(w, body.Confirm, r.PathValue("bucket")) {
		return
	}
	if err := a.JS.DeleteKeyValue(r.Context(), r.PathValue("bucket")); err != nil {
		writeKVError(w, a, r, err)
		return
	}
	writeJSON(w, struct{}{})
}

// decodeBucket reads nats.go's KeyValueConfig JSON, ttl in nanoseconds,
// refusing unknown keys so a typo cannot be silently dropped.
func decodeBucket(w http.ResponseWriter, r *http.Request) (cfg jetstream.KeyValueConfig, ok bool) {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBody))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&cfg); err != nil {
		writeFieldError(w, fmt.Errorf("The bucket config is not valid JSON: %w", err), "")
		return cfg, false
	}
	return cfg, true
}

func writeBucketError(w http.ResponseWriter, err error) {
	if errors.Is(err, jetstream.ErrHistoryTooLarge) {
		writeFieldError(w, errors.New("A bucket keeps at most 64 revisions per key."), "history")
		return
	}
	writeHintedError(w, err, bucketHints)
}

func writeBucketRow(w http.ResponseWriter, r *http.Request, kv jetstream.KeyValue) {
	st, err := kv.Status(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, bucketRow(st))
}

// bucketHints maps words in a server refusal to the KeyValueConfig key it is about.
var bucketHints = []struct{ word, field string }{
	{"replicas", "num_replicas"}, {"peers", "num_replicas"},
	{"storage", "storage"}, {"compression", "compression"},
	{"max bytes", "max_bytes"}, {"max_bytes", "max_bytes"},
	{"max msg size", "max_value_size"}, {"max_msg_size", "max_value_size"}, {"message size", "max_value_size"},
	{"max age", "ttl"}, {"max_age", "ttl"},
	{"description", "description"},
}

// kvValue sends a key's value, or ?revision='s, as raw bytes. It answers Range
// requests, as a message payload does, for the payload viewer.
func (s *server) kvValue(w http.ResponseWriter, r *http.Request) {
	a, kv := s.bucket(w, r)
	if kv == nil {
		return
	}
	key := r.PathValue("key")
	var e jetstream.KeyValueEntry
	var err error
	if rev := r.URL.Query().Get("revision"); rev != "" {
		n, perr := strconv.ParseUint(rev, 10, 64)
		if perr != nil {
			http.Error(w, "revision must be a number", http.StatusBadRequest)
			return
		}
		e, err = kv.GetRevision(r.Context(), key, n)
	} else {
		e, err = kv.Get(r.Context(), key)
	}
	if err != nil {
		writeKVError(w, a, r, err)
		return
	}
	// Never let a browser render a value as a page of this origin.
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Disposition", "attachment")
	w.Header().Set("Content-Security-Policy", "sandbox")
	w.Header().Set("Cache-Control", "no-store")
	http.ServeContent(w, r, "", e.Created(), bytes.NewReader(e.Value()))
}

// kvPut stores the request body, raw, as the key's new value.
func (s *server) kvPut(w http.ResponseWriter, r *http.Request) {
	a, kv := s.bucket(w, r)
	if kv == nil {
		return
	}
	max := int64(a.NC.MaxPayload())
	val, err := io.ReadAll(http.MaxBytesReader(w, r.Body, max))
	if err != nil {
		http.Error(w, fmt.Sprintf("A value can be at most %d bytes, the server's max payload.", max), http.StatusRequestEntityTooLarge)
		return
	}
	rev, err := kv.Put(r.Context(), r.PathValue("key"), val)
	if err != nil {
		writeKVError(w, a, r, err)
		return
	}
	writeJSON(w, map[string]uint64{"revision": rev})
}

// kvDelete puts a delete marker on the key, or with ?purge=true removes its history too.
func (s *server) kvDelete(w http.ResponseWriter, r *http.Request) {
	a, kv := s.bucket(w, r)
	if kv == nil {
		return
	}
	var err error
	if r.URL.Query().Get("purge") == "true" {
		err = kv.Purge(r.Context(), r.PathValue("key"))
	} else {
		err = kv.Delete(r.Context(), r.PathValue("key"))
	}
	if err != nil {
		writeKVError(w, a, r, err)
		return
	}
	writeJSON(w, struct{}{})
}

// kvHistory lists every kept revision of a key, oldest first, without values.
func (s *server) kvHistory(w http.ResponseWriter, r *http.Request) {
	a, kv := s.bucket(w, r)
	if kv == nil {
		return
	}
	hist, err := kv.History(r.Context(), r.PathValue("key"), jetstream.MetaOnly())
	if err != nil {
		writeKVError(w, a, r, err)
		return
	}
	out := make([]api.KVEntry, 0, len(hist))
	for _, e := range hist {
		out = append(out, live.KVEntry(e))
	}
	writeJSON(w, out)
}

// bucket opens {bucket} in the active Context, or answers why it cannot.
func (s *server) bucket(w http.ResponseWriter, r *http.Request) (*contexts.Conn, jetstream.KeyValue) {
	a := s.jetStream(w)
	if a == nil {
		return nil, nil
	}
	kv, err := a.JS.KeyValue(r.Context(), r.PathValue("bucket"))
	if err != nil {
		writeKVError(w, a, r, err)
		return nil, nil
	}
	return a, kv
}

func writeKVError(w http.ResponseWriter, a *contexts.Conn, r *http.Request, err error) {
	switch {
	case errors.Is(err, jetstream.ErrBucketNotFound), errors.Is(err, jetstream.ErrInvalidBucketName):
		http.Error(w, fmt.Sprintf("%s has no bucket named %s.", a.Context.Name, r.PathValue("bucket")), http.StatusNotFound)
	case errors.Is(err, jetstream.ErrKeyNotFound):
		http.Error(w, fmt.Sprintf("Bucket %s has no value for %s there: it was deleted or never set.", r.PathValue("bucket"), r.PathValue("key")), http.StatusNotFound)
	case errors.Is(err, jetstream.ErrInvalidKey):
		http.Error(w, err.Error(), http.StatusBadRequest)
	default:
		writeError(w, err)
	}
}
