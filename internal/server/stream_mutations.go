package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/nats-io/jsm.go"
	jsmapi "github.com/nats-io/jsm.go/api"

	"github.com/CirXe0N/natter/internal/api"
)

// decodeConfig reads a stream config in the server's own JSON shape. Unknown
// keys are refused so a typo cannot be silently dropped.
func decodeConfig(w http.ResponseWriter, r *http.Request) (cfg jsmapi.StreamConfig, ok bool) {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&cfg); err != nil {
		writeFieldError(w, fmt.Errorf("The stream config is not valid JSON: %w", err), "")
		return cfg, false
	}
	return cfg, true
}

func (s *server) createStream(w http.ResponseWriter, r *http.Request) {
	a := s.jetStream(w)
	if a == nil {
		return
	}
	cfg, ok := decodeConfig(w, r)
	if !ok {
		return
	}
	st, err := a.JSM.NewStreamFromDefault(cfg.Name, cfg)
	if err != nil {
		writeFieldError(w, err)
		return
	}
	s.writeSummary(w, st)
}

func (s *server) updateStream(w http.ResponseWriter, r *http.Request) {
	a := s.jetStream(w)
	if a == nil {
		return
	}
	st, err := loadStream(a, r.PathValue("name"))
	if err != nil {
		writeStreamError(w, err)
		return
	}
	cfg, ok := decodeConfig(w, r)
	if !ok {
		return
	}
	if cfg.Name != st.Name() {
		writeFieldError(w, errors.New("A stream cannot be renamed."), "name")
		return
	}
	if err := st.UpdateConfiguration(cfg); err != nil {
		writeFieldError(w, err)
		return
	}
	s.writeSummary(w, st)
}

func (s *server) writeSummary(w http.ResponseWriter, st *jsm.Stream) {
	info, err := st.LatestInformation()
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, summarize(info))
}

// confirmed refuses a purge or delete unless the body repeats the stream name.
// The UI asks for it, and the API asks too so a stray request cannot wipe data.
func confirmed(w http.ResponseWriter, got, name string) bool {
	if got != name {
		http.Error(w, "Type the stream name in confirm to do this.", http.StatusBadRequest)
		return false
	}
	return true
}

func (s *server) purgeStream(w http.ResponseWriter, r *http.Request) {
	a := s.jetStream(w)
	if a == nil {
		return
	}
	var body api.StreamPurge
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&body); err != nil {
		http.Error(w, "The purge request is not valid JSON.", http.StatusBadRequest)
		return
	}
	st, err := loadStream(a, r.PathValue("name"))
	if err != nil {
		writeStreamError(w, err)
		return
	}
	if !confirmed(w, body.Confirm, st.Name()) {
		return
	}
	res, err := st.PurgeExt(&jsmapi.JSApiStreamPurgeRequest{Subject: body.Subject, Keep: body.Keep, Sequence: body.Sequence})
	if err != nil {
		writeFieldError(w, err)
		return
	}
	writeJSON(w, api.StreamPurged{Purged: res.Purged})
}

func (s *server) deleteStream(w http.ResponseWriter, r *http.Request) {
	a := s.jetStream(w)
	if a == nil {
		return
	}
	var body api.StreamDelete
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&body); err != nil {
		http.Error(w, "The delete request is not valid JSON.", http.StatusBadRequest)
		return
	}
	st, err := loadStream(a, r.PathValue("name"))
	if err != nil {
		writeStreamError(w, err)
		return
	}
	if !confirmed(w, body.Confirm, st.Name()) {
		return
	}
	if err := st.Delete(); err != nil {
		writeStreamError(w, err)
		return
	}
	writeJSON(w, struct{}{})
}

// fieldHints maps words in a refusal to the config key they are about, first
// match wins. Order matters: "max age" must be tried before "age"-like words.
var fieldHints = []struct{ word, field string }{
	{"already in use", "name"}, {"name", "name"},
	{"overlap", "subjects"}, {"subject", "subjects"},
	{"replicas", "num_replicas"}, {"peers", "num_replicas"},
	{"storage", "storage"}, {"retention", "retention"}, {"discard", "discard"},
	{"max age", "max_age"}, {"max_age", "max_age"},
	{"duplicate", "duplicate_window"},
	{"max bytes", "max_bytes"}, {"max_bytes", "max_bytes"},
	{"max msg size", "max_msg_size"}, {"max_msg_size", "max_msg_size"}, {"message size", "max_msg_size"},
	{"max msgs per", "max_msgs_per_subject"}, {"max_msgs_per", "max_msgs_per_subject"},
	{"max msgs", "max_msgs"}, {"max_msgs", "max_msgs"},
	{"max consumers", "max_consumers"}, {"max_consumers", "max_consumers"},
	{"description", "description"},
}

// writeFieldError answers 400 with the refusal and the config key it belongs
// to. Errors that are not about the request (timeouts, no connection) fall
// through to writeError. field overrides the guess.
func writeFieldError(w http.ResponseWriter, err error, field ...string) {
	var apiErr jsmapi.ApiError
	if jsm.IsNatsError(err, 10059) { // JSStreamNotFoundErr
		writeStreamError(w, err)
		return
	}
	invalid := len(field) > 0 || errors.As(err, &apiErr) || strings.HasPrefix(err.Error(), "configuration validation failed") || strings.Contains(err.Error(), "not a valid stream name") || strings.HasPrefix(err.Error(), "The stream config")
	if !invalid {
		writeStreamError(w, err)
		return
	}
	body := api.FieldError{Error: err.Error()}
	if len(field) > 0 {
		body.Field = field[0]
	} else {
		msg := strings.ToLower(err.Error())
		for _, h := range fieldHints {
			if strings.Contains(msg, h.word) {
				body.Field = h.field
				break
			}
		}
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusBadRequest)
	_ = json.NewEncoder(w).Encode(body)
}
