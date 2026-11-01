package server

import (
	"errors"
	"fmt"
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
		route{pattern: "GET /api/kv/{bucket}/keys/{key...}", handle: (*server).kvValue},
		route{pattern: "GET /api/kv/{bucket}/history/{key...}", handle: (*server).kvHistory},
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
		cfg := st.Config()
		out = append(out, api.KVBucket{
			Bucket: st.Bucket(), Values: st.Values(), History: st.History(), TTL: int64(st.TTL().Seconds()),
			Bytes: st.Bytes(), Storage: strings.ToLower(cfg.Storage.String()), Replicas: cfg.Replicas,
		})
	}
	if err := l.Error(); err != nil {
		writeError(w, err)
		return
	}
	slices.SortFunc(out, func(x, y api.KVBucket) int { return strings.Compare(x.Bucket, y.Bucket) })
	writeJSON(w, out)
}

// kvValue sends a key's value, or ?revision='s, as raw bytes.
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
	w.Write(e.Value())
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
