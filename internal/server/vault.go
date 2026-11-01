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
		route{pattern: "PUT /api/vault/passphrase", handle: (*server).setPassphrase, allowReadOnly: true},
		route{pattern: "POST /api/vault/keyring", handle: (*server).keyringOn, allowReadOnly: true},
		route{pattern: "DELETE /api/vault/keyring", handle: (*server).keyringOff, allowReadOnly: true},
		// These write Natter's own files, which Read-only allows. Writing or removing a CLI file is natscli's state, so each handler refuses that under Read-only itself.
		route{pattern: "POST /api/contexts", handle: (*server).createContext, allowReadOnly: true},
		route{pattern: "PUT /api/contexts/{source}/{name}", handle: (*server).updateContext, allowReadOnly: true},
		route{pattern: "POST /api/contexts/{source}/{name}/move-to-vault", handle: (*server).moveIntoVault, allowReadOnly: true},
		route{pattern: "POST /api/contexts/{source}/{name}/remove", handle: (*server).removeContext, allowReadOnly: true},
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

// setPassphrase changes the passphrase, or adds one to a Vault unlocked by
// -vault-key or the keyring. Only vault.key.age changes.
func (s *server) setPassphrase(w http.ResponseWriter, r *http.Request) {
	var p api.PassphraseChange
	if !readJSON(w, r, &p) {
		return
	}
	if err := s.Contexts.Vault().SetPassphrase(p.Current, p.New); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, s.Contexts.Vault().Status())
}

// keyringOn and keyringOff move the Vault key into or out of the OS keyring.
// Only the key moves; the secrets stay in vault.age.
func (s *server) keyringOn(w http.ResponseWriter, r *http.Request)  { s.setKeyring(w, r, true) }
func (s *server) keyringOff(w http.ResponseWriter, r *http.Request) { s.setKeyring(w, r, false) }

func (s *server) setKeyring(w http.ResponseWriter, r *http.Request, on bool) {
	if err := s.Contexts.Vault().SetKeyring(r.Context(), on); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, s.Contexts.Vault().Status())
}

func (s *server) createContext(w http.ResponseWriter, r *http.Request) {
	var n api.NewContext
	if !readJSON(w, r, &n) {
		return
	}
	if n.Source == api.SourceCLI && s.readOnly() {
		refuseReadOnly(w)
		return
	}
	c, err := s.Contexts.Create(r.Context(), n)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, c)
}

func (s *server) moveIntoVault(w http.ResponseWriter, r *http.Request) {
	var req api.MoveRequest
	if !readJSON(w, r, &req) {
		return
	}
	ref := pathRef(r)
	c, err := s.Contexts.MoveIntoVault(r.Context(), ref, req.Name)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, c)
}

// updateContext edits a Context and reconnects it if it is the active one.
func (s *server) updateContext(w http.ResponseWriter, r *http.Request) {
	var u api.ContextUpdate
	if !readJSON(w, r, &u) {
		return
	}
	ref := pathRef(r)
	if ref.Source == api.SourceCLI && s.readOnly() {
		refuseReadOnly(w)
		return
	}
	c, err := s.Contexts.Update(r.Context(), ref, u)
	if err != nil {
		writeError(w, err)
		return
	}
	if a := s.Contexts.Active(); a != nil && a.Context.Ref == ref {
		if err := s.Contexts.Activate(r.Context(), ref); err != nil {
			writeError(w, err)
			return
		}
	}
	writeJSON(w, c)
}

// removeContext deletes a Context, and only with confirm: true.
func (s *server) removeContext(w http.ResponseWriter, r *http.Request) {
	var req api.RemoveRequest
	if !readJSON(w, r, &req) {
		return
	}
	if !req.Confirm {
		http.Error(w, "removing a Context needs confirm: true", http.StatusBadRequest)
		return
	}
	ref := pathRef(r)
	if ref.Source == api.SourceCLI && s.readOnly() {
		refuseReadOnly(w)
		return
	}
	if err := s.Contexts.Remove(r.Context(), ref); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, struct{}{})
}

// pathRef is the Context a /api/contexts/{source}/{name} path names.
func pathRef(r *http.Request) api.Ref {
	return api.Ref{Source: api.Source(r.PathValue("source")), Name: r.PathValue("name")}
}
