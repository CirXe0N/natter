package server

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/CirXe0N/natter/internal/api"
	"github.com/CirXe0N/natter/internal/contexts"
	"github.com/CirXe0N/natter/internal/vault"
)

func init() {
	routes = append(routes,
		route{pattern: "GET /api/contexts", handle: (*server).listContexts},
		route{pattern: "GET /api/contexts/active", handle: (*server).activeContext},
		route{pattern: "PUT /api/contexts/active", handle: (*server).activateContext, allowReadOnly: true},
		route{pattern: "PUT /api/contexts/{source}/{name}/settings", handle: (*server).setContextSettings, allowReadOnly: true},
	)
}

func (s *server) listContexts(w http.ResponseWriter, r *http.Request) {
	list, err := s.Contexts.List(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, list)
}

func (s *server) activeContext(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, s.Contexts.Status())
}

// activateContext switches to the Ref in the body and answers with the new
// status. A failed connect is a 200 whose status is failed, with the error.
func (s *server) activateContext(w http.ResponseWriter, r *http.Request) {
	var ref api.Ref
	if !readJSON(w, r, &ref) {
		return
	}
	if err := s.Contexts.Activate(r.Context(), ref); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, s.Contexts.Status())
}

func (s *server) setContextSettings(w http.ResponseWriter, r *http.Request) {
	var settings api.Settings
	if !readJSON(w, r, &settings) {
		return
	}
	ref := pathRef(r)
	if err := s.Contexts.SetSettings(r.Context(), ref, settings); err != nil {
		writeError(w, err)
		return
	}
	c, err := s.Contexts.Get(r.Context(), ref)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, c)
}

// maxBody caps every JSON request body.
const maxBody = 1 << 20

func readJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	if err := json.NewDecoder(io.LimitReader(r.Body, maxBody)).Decode(v); err != nil {
		http.Error(w, "invalid JSON body: "+err.Error(), http.StatusBadRequest)
		return false
	}
	return true
}

// writeError maps domain errors to a status. The body is the error text, which
// the UI shows as is.
func writeError(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	switch {
	case errors.Is(err, contexts.ErrUnknown):
		status = http.StatusNotFound
	case errors.Is(err, contexts.ErrInvalid), errors.Is(err, vault.ErrWrongKey), errors.Is(err, vault.ErrEmpty):
		status = http.StatusBadRequest
	case errors.Is(err, vault.ErrLocked):
		status = http.StatusLocked
	case errors.Is(err, vault.ErrExists), errors.Is(err, vault.ErrNoPassphrase), errors.Is(err, vault.ErrNoKeyring), errors.Is(err, vault.ErrOnlyKey):
		status = http.StatusConflict
	}
	http.Error(w, err.Error(), status)
}
