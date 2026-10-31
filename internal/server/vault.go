package server

import (
	"net/http"

	"github.com/CirXe0N/natter/internal/api"
)

func init() {
	routes = append(routes,
		route{pattern: "GET /api/vault", handle: (*server).vaultStatus},
		route{pattern: "POST /api/vault", handle: (*server).createVault, allowReadOnly: true},
		route{pattern: "POST /api/vault/unlock", handle: (*server).unlockVault, allowReadOnly: true},
		route{pattern: "POST /api/contexts", handle: (*server).createContext, allowReadOnly: true},
	)
}

func (s *server) vaultStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, s.Contexts.Vault().Status())
}

func (s *server) createVault(w http.ResponseWriter, r *http.Request) {
	var p api.Passphrase
	if !readJSON(w, r, &p) {
		return
	}
	if err := s.Contexts.Vault().Create(p.Passphrase); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, s.Contexts.Vault().Status())
}

// unlockVault also reconnects the active Context if it was waiting for the Vault.
func (s *server) unlockVault(w http.ResponseWriter, r *http.Request) {
	var p api.Passphrase
	if !readJSON(w, r, &p) {
		return
	}
	if err := s.Contexts.Vault().UnlockPassphrase(p.Passphrase); err != nil {
		writeError(w, err)
		return
	}
	if a := s.Contexts.Active(); a != nil && a.Status == api.ConnStatusLocked {
		if err := s.Contexts.Activate(r.Context(), a.Context.Ref); err != nil {
			writeError(w, err)
			return
		}
	}
	writeJSON(w, s.Contexts.Vault().Status())
}

func (s *server) createContext(w http.ResponseWriter, r *http.Request) {
	var n api.NewContext
	if !readJSON(w, r, &n) {
		return
	}
	c, err := s.Contexts.Create(r.Context(), n)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, c)
}
