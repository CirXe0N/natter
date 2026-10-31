package server

import "net/http"

import "github.com/CirXe0N/natter/internal/live"

func init() {
	routes = append(routes, route{pattern: "GET /api/health", handle: (*server).health})
}

func (s *server) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, live.CheckHealth(r.Context(), s.Contexts.Active()))
}
