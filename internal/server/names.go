package server

import (
	"net/http"
	"strings"

	"github.com/CirXe0N/natter/internal/api"
)

func init() {
	routes = append(routes, route{pattern: "GET /api/jetstream/names", handle: (*server).jetStreamNames})
}

// jetStreamNames lists the active Context's streams and KV buckets for the
// command palette. KV buckets are streams named KV_<bucket>. No JetStream, or
// no connection yet, gives empty lists.
func (s *server) jetStreamNames(w http.ResponseWriter, r *http.Request) {
	names := api.JetStreamNames{Streams: []string{}, Buckets: []string{}}
	a := s.Contexts.Active()
	if a == nil || a.JSM == nil {
		writeJSON(w, names)
		return
	}
	list, err := a.JSM.StreamNames(nil)
	if err != nil {
		writeError(w, err)
		return
	}
	for _, n := range list {
		if b, ok := strings.CutPrefix(n, "KV_"); ok {
			names.Buckets = append(names.Buckets, b)
		} else {
			names.Streams = append(names.Streams, n)
		}
	}
	writeJSON(w, names)
}
