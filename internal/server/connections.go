package server

import (
	"encoding/json"
	"errors"
	"github.com/nats-io/nkeys"
	"net/http"

	"github.com/CirXe0N/natter/internal/api"
	"github.com/CirXe0N/natter/internal/live"
)

// Kick is a POST with no allowReadOnly, so Read-only mode refuses it in the
// route table like every other change to the server.
func init() {
	routes = append(routes,
		route{pattern: "GET /api/connections", handle: (*server).connections},
		route{pattern: "POST /api/connections/kick", handle: (*server).kick},
	)
}

func (s *server) connections(w http.ResponseWriter, r *http.Request) {
	state := api.ConnectionState(r.URL.Query().Get("state"))
	if state != api.ConnectionStateClosed {
		state = api.ConnectionStateOpen
	}
	writeJSON(w, live.ListConnections(r.Context(), s.Contexts.Active(), state))
}

func (s *server) kick(w http.ResponseWriter, r *http.Request) {
	var k api.KickRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBody)).Decode(&k); err != nil || !nkeys.IsValidPublicServerKey(k.Server) || k.Cid == 0 {
		http.Error(w, "The body needs server (a server ID) and cid.", http.StatusBadRequest)
		return
	}
	switch err := live.Kick(r.Context(), s.Contexts.Active(), k); {
	case errors.Is(err, live.ErrNoSystem):
		http.Error(w, err.Error(), http.StatusForbidden)
	case err != nil:
		http.Error(w, err.Error(), http.StatusBadGateway)
	default:
		writeJSON(w, struct{}{})
	}
}
