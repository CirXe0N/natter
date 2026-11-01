package server

import (
	"errors"
	"net/http"

	"github.com/CirXe0N/natter/internal/api"
	"github.com/CirXe0N/natter/internal/examples"
)

// Example messages are Natter's own files, so editing them is fine under
// Read-only mode. Resending one goes through POST /api/send, which is not.
func init() {
	routes = append(routes,
		route{pattern: "GET /api/examples", handle: (*server).listExamples},
		route{pattern: "POST /api/examples", handle: (*server).createExample, allowReadOnly: true},
		route{pattern: "PUT /api/examples/{id}", handle: (*server).updateExample, allowReadOnly: true},
		route{pattern: "DELETE /api/examples/{id}", handle: (*server).deleteExample, allowReadOnly: true},
		route{pattern: "POST /api/examples/copy", handle: (*server).copyExamples, allowReadOnly: true},
	)
}

func (s *server) exampleStore() *examples.Store { return examples.Open(s.Contexts.Dir()) }

func writeExampleError(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	switch {
	case errors.Is(err, examples.ErrInvalid):
		status = http.StatusBadRequest
	case errors.Is(err, examples.ErrUnknown):
		status = http.StatusNotFound
	case errors.Is(err, examples.ErrConflict):
		status = http.StatusConflict
	}
	http.Error(w, err.Error(), status)
}

func (s *server) listExamples(w http.ResponseWriter, r *http.Request) {
	all, err := s.exampleStore().List()
	if err != nil {
		writeExampleError(w, err)
		return
	}
	writeJSON(w, all)
}

func (s *server) createExample(w http.ResponseWriter, r *http.Request) {
	var e api.Example
	if !readJSON(w, r, &e) {
		return
	}
	e, err := s.exampleStore().Create(e)
	if err != nil {
		writeExampleError(w, err)
		return
	}
	writeJSON(w, e)
}

func (s *server) updateExample(w http.ResponseWriter, r *http.Request) {
	var e api.Example
	if !readJSON(w, r, &e) {
		return
	}
	e.ID = r.PathValue("id")
	e, err := s.exampleStore().Update(e)
	if err != nil {
		writeExampleError(w, err)
		return
	}
	writeJSON(w, e)
}

func (s *server) deleteExample(w http.ResponseWriter, r *http.Request) {
	if err := s.exampleStore().Delete(r.PathValue("id")); err != nil {
		writeExampleError(w, err)
		return
	}
	writeJSON(w, struct{}{})
}

func (s *server) copyExamples(w http.ResponseWriter, r *http.Request) {
	var c api.ExampleCopy
	if !readJSON(w, r, &c) {
		return
	}
	made, err := s.exampleStore().Copy(c.IDs, c.Context, c.Choices)
	if err != nil {
		writeExampleError(w, err)
		return
	}
	writeJSON(w, made)
}
