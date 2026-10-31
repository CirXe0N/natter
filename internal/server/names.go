package server

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/nats-io/nats.go/jetstream"

	"github.com/CirXe0N/natter/internal/api"
)

func init() {
	routes = append(routes, route{pattern: "GET /api/jetstream/names", handle: (*server).jetStreamNames})
}

// jetStreamNames lists the active Context's streams and KV buckets for the
// command palette. KV buckets are streams named KV_<bucket>. No JetStream, or
// no connection yet, gives empty lists.
// shortcut: ignores a Context's JetStream domain or API prefix, switch to its JSMOptions when ticket 12 adds a JetStream client.
func (s *server) jetStreamNames(w http.ResponseWriter, r *http.Request) {
	names := api.JetStreamNames{Streams: []string{}, Buckets: []string{}}
	a := s.Contexts.Active()
	if a == nil || a.NC == nil || !a.Caps.JetStream {
		writeJSON(w, names)
		return
	}
	js, err := jetstream.New(a.NC)
	if err != nil {
		writeError(w, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	list := js.StreamNames(ctx)
	for n := range list.Name() {
		if b, ok := strings.CutPrefix(n, "KV_"); ok {
			names.Buckets = append(names.Buckets, b)
		} else {
			names.Streams = append(names.Streams, n)
		}
	}
	if err := list.Err(); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, names)
}
