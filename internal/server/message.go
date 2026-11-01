package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"mime"
	"net/http"
	"strconv"

	"github.com/nats-io/jsm.go"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"

	"github.com/CirXe0N/natter/internal/api"
	"github.com/CirXe0N/natter/internal/contexts"
)

// One opened message (ADR-0003): its headers as JSON, its payload as raw bytes
// so the browser can ask for the first 64 KB with a Range request, and delete.
func init() {
	routes = append(routes,
		route{pattern: "GET /api/streams/{name}/messages/{seq}", handle: (*server).getMessage},
		route{pattern: "GET /api/streams/{name}/messages/{seq}/payload", handle: (*server).getPayload},
		route{pattern: "DELETE /api/streams/{name}/messages/{seq}", handle: (*server).deleteMessage},
	)
}

var errNoMsg = errors.New("no message with that sequence")

// fetchMsg reads one message with a Direct Get when the stream allows it. Any
// replica answers a Direct Get, and a follower that has not caught up answers
// 404, so a 404 is asked once more of the leader with STREAM.MSG.GET.
func fetchMsg(ctx context.Context, a *contexts.Conn, name string, seq uint64) (*jetstream.RawStreamMsg, error) {
	if !jsm.IsValidName(name) {
		return nil, fmt.Errorf("%w: %q", errNoStream, name)
	}
	st, err := a.JS.Stream(ctx, name)
	if err != nil {
		return nil, err
	}
	direct := st.CachedInfo().Config.AllowDirect
	m, err := st.GetMsg(ctx, seq)
	if err == nil && direct {
		// A Direct Get appends these to the message's own headers, which may hold the same keys.
		for _, k := range []string{jetstream.StreamHeader, jetstream.SubjectHeader, jetstream.SequenceHeader, jetstream.TimeStampHeaer} {
			if v := m.Header[k]; len(v) > 1 {
				m.Header[k] = v[:len(v)-1]
			} else {
				delete(m.Header, k)
			}
		}
	}
	if !errors.Is(err, jetstream.ErrMsgNotFound) || !direct {
		return m, err
	}
	ls, err := a.JSM.LoadStream(name)
	if err != nil {
		return nil, err
	}
	sm, err := ls.ReadMessage(seq)
	if err != nil {
		return nil, err
	}
	var h nats.Header
	if len(sm.Header) > 0 {
		if h, err = nats.DecodeHeadersMsg(sm.Header); err != nil {
			return nil, err
		}
	}
	return &jetstream.RawStreamMsg{Subject: sm.Subject, Sequence: sm.Sequence, Header: h, Data: sm.Data, Time: sm.Time}, nil
}

// openMsg answers the request's error itself and returns nil on any failure.
func (s *server) openMsg(w http.ResponseWriter, r *http.Request) *jetstream.RawStreamMsg {
	a := s.jetStream(w)
	if a == nil {
		return nil
	}
	seq, err := strconv.ParseUint(r.PathValue("seq"), 10, 64)
	if err != nil || seq == 0 {
		http.Error(w, "The sequence must be a whole number from 1.", http.StatusBadRequest)
		return nil
	}
	m, err := fetchMsg(r.Context(), a, r.PathValue("name"), seq)
	if err != nil {
		writeMsgError(w, err)
		return nil
	}
	return m
}

func writeMsgError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, jetstream.ErrMsgNotFound), jsm.IsNatsError(err, 10037), jsm.IsNatsError(err, 10043): // JSNoMessageFoundErr, JSSequenceNotFoundErrF
		http.Error(w, errNoMsg.Error(), http.StatusNotFound)
	case errors.Is(err, jetstream.ErrStreamNotFound):
		http.Error(w, err.Error(), http.StatusNotFound)
	default:
		writeStreamError(w, err)
	}
}

func (s *server) getMessage(w http.ResponseWriter, r *http.Request) {
	m := s.openMsg(w, r)
	if m == nil {
		return
	}
	if m.Header == nil {
		m.Header = nats.Header{}
	}
	writeJSON(w, api.Msg{Seq: m.Sequence, Subject: m.Subject, Time: m.Time, Size: len(m.Data), Headers: m.Header})
}

// getPayload serves the bytes with ServeContent, which answers Range requests.
// The type is fixed and sniffing is off, so a payload holding HTML can never
// run as a page on Natter's origin.
func (s *server) getPayload(w http.ResponseWriter, r *http.Request) {
	m := s.openMsg(w, r)
	if m == nil {
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "sandbox")
	w.Header().Set("Cache-Control", "no-store")
	if r.URL.Query().Has("download") {
		w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": fmt.Sprintf("%s-%d.bin", r.PathValue("name"), m.Sequence)}))
	}
	http.ServeContent(w, r, "", m.Time, bytes.NewReader(m.Data))
}

func (s *server) deleteMessage(w http.ResponseWriter, r *http.Request) {
	a := s.jetStream(w)
	if a == nil {
		return
	}
	var body api.MsgDelete
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBody)).Decode(&body); err != nil {
		http.Error(w, "The delete request is not valid JSON.", http.StatusBadRequest)
		return
	}
	seq, err := strconv.ParseUint(r.PathValue("seq"), 10, 64)
	if err != nil || seq == 0 {
		http.Error(w, "The sequence must be a whole number from 1.", http.StatusBadRequest)
		return
	}
	st, err := loadStream(a, r.PathValue("name"))
	if err != nil {
		writeStreamError(w, err)
		return
	}
	if err := a.JSM.DeleteStreamMessage(st.Name(), seq, !body.Erase); err != nil {
		writeMsgError(w, err)
		return
	}
	writeJSON(w, struct{}{})
}
