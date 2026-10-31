package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/nats-io/jsm.go"
	jsmapi "github.com/nats-io/jsm.go/api"
	natsserver "github.com/nats-io/nats-server/v2/server"

	"github.com/CirXe0N/natter/internal/api"
	"github.com/CirXe0N/natter/internal/contexts"
)

func init() {
	routes = append(routes,
		route{pattern: "GET /api/streams", handle: (*server).listStreams},
		route{pattern: "GET /api/streams/{name}", handle: (*server).streamDetail},
		route{pattern: "GET /api/streams/{name}/subjects", handle: (*server).streamSubjects},
	)
}

// jetStream returns the active Context when it has a JetStream manager, or
// answers 409 with the reason it has none.
func (s *server) jetStream(w http.ResponseWriter) *contexts.Conn {
	a := s.Contexts.Active()
	switch {
	case a == nil:
		http.Error(w, "No Context is active. Pick one on the Contexts screen.", http.StatusConflict)
	case a.NC == nil:
		http.Error(w, fmt.Sprintf("%s is not connected (%s).", a.Context.Name, a.Status), http.StatusConflict)
	case a.JSM == nil:
		http.Error(w, fmt.Sprintf("JetStream is not available to %s's account.", a.Context.Name), http.StatusConflict)
	default:
		return a
	}
	return nil
}

// listStreams pages through $JS.API.STREAM.LIST (256 per page) with jsm.go.
// ?subject= keeps only streams whose subjects overlap it.
func (s *server) listStreams(w http.ResponseWriter, r *http.Request) {
	a := s.jetStream(w)
	if a == nil {
		return
	}
	streams, missing, offline, err := a.JSM.Streams(&jsm.StreamNamesFilter{Subject: r.URL.Query().Get("subject")})
	if err != nil {
		writeError(w, err)
		return
	}
	list := api.StreamList{Streams: []api.StreamSummary{}, Offline: map[string]string{}}
	for _, st := range streams {
		info, _ := st.LatestInformation() // the list response already carried it
		list.Streams = append(list.Streams, summarize(info))
	}
	for name, reason := range offline {
		list.Offline[name] = reason
	}
	for _, name := range missing {
		list.Offline[name] = "The server listed this stream but sent no details."
	}
	writeJSON(w, list)
}

func (s *server) streamDetail(w http.ResponseWriter, r *http.Request) {
	a := s.jetStream(w)
	if a == nil {
		return
	}
	st, err := loadStream(a, r.PathValue("name"))
	if err != nil {
		writeStreamError(w, err)
		return
	}
	info, err := st.LatestInformation()
	if err != nil {
		writeError(w, err)
		return
	}
	cfg, err := json.Marshal(info.Config)
	if err != nil {
		writeError(w, err)
		return
	}
	d := api.StreamDetail{
		StreamSummary: summarize(info),
		Description:   info.Config.Description,
		Created:       info.Created,
		FirstSeq:      info.State.FirstSeq,
		LastSeq:       info.State.LastSeq,
		NumDeleted:    info.State.NumDeleted,
		NumSubjects:   info.State.NumSubjects,
		MaxPayload:    a.NC.MaxPayload(),
		Config:        cfg,
		ReplicaState:  []api.Replica{},
		Sources:       []api.SourceState{},
	}
	if c := info.Cluster; c != nil {
		d.Cluster = c.Name
		if c.Leader != "" {
			d.ReplicaState = append(d.ReplicaState, api.Replica{Name: c.Leader, Leader: true, Current: true})
		}
		for _, p := range c.Replicas {
			d.ReplicaState = append(d.ReplicaState, api.Replica{Name: p.Name, Current: p.Current, Offline: p.Offline, Lag: p.Lag, Active: int64(p.Active)})
		}
	}
	if info.Mirror != nil {
		m := sourceState(info.Mirror)
		d.Mirror = &m
	}
	for _, src := range info.Sources {
		d.Sources = append(d.Sources, sourceState(src))
	}
	writeJSON(w, d)
}

// streamSubjects asks STREAM.INFO with subjects_filter (?filter=, default >)
// for one page of subjects and their counts.
func (s *server) streamSubjects(w http.ResponseWriter, r *http.Request) {
	a := s.jetStream(w)
	if a == nil {
		return
	}
	filter := r.URL.Query().Get("filter")
	if filter == "" {
		filter = ">"
	}
	st, err := loadStream(a, r.PathValue("name"))
	if err != nil {
		writeStreamError(w, err)
		return
	}
	// shortcut: one page only (the server's 100,000 subjects), so a huge stream cannot flood the browser; page with offset if users need more than a narrower filter.
	info, err := st.Information(jsmapi.JSApiStreamInfoRequest{SubjectsFilter: filter})
	if err != nil {
		writeStreamError(w, err)
		return
	}
	subjects := info.State.Subjects
	if subjects == nil {
		subjects = map[string]uint64{}
	}
	writeJSON(w, api.StreamSubjects{Filter: filter, Subjects: subjects, Truncated: len(subjects) >= natsserver.JSMaxSubjectDetails})
}

func summarize(info *jsmapi.StreamInfo) api.StreamSummary {
	c := info.Config
	kind := api.StreamKindStream
	switch {
	case jsm.IsKVBucketStream(c.Name):
		kind = api.StreamKindKV
	case jsm.IsObjectBucketStream(c.Name):
		kind = api.StreamKindObject
	}
	sum := api.StreamSummary{
		Name:      c.Name,
		Kind:      kind,
		Subjects:  c.Subjects,
		Storage:   strings.ToLower(c.Storage.String()),
		Replicas:  c.Replicas,
		Msgs:      info.State.Msgs,
		Bytes:     info.State.Bytes,
		Consumers: info.State.Consumers,
	}
	if sum.Subjects == nil {
		sum.Subjects = []string{}
	}
	if info.State.Msgs > 0 {
		sum.FirstTime, sum.LastTime = &info.State.FirstTime, &info.State.LastTime
	}
	if info.Cluster != nil {
		sum.Leader = info.Cluster.Leader
	}
	sum.Health, sum.Problem = health(info)
	return sum
}

// health picks the worst problem a stream shows: no leader, a broken mirror
// or source, or lost data are errors; a replica that is offline or behind is
// a warning.
func health(info *jsmapi.StreamInfo) (api.StreamHealth, string) {
	if info.Cluster != nil && info.Cluster.Leader == "" {
		return api.StreamHealthError, "The stream has no leader."
	}
	for _, src := range append([]*jsmapi.StreamSourceInfo{info.Mirror}, info.Sources...) {
		if src != nil && src.Error != nil {
			return api.StreamHealthError, fmt.Sprintf("%s: %s", src.Name, src.Error.Description)
		}
	}
	if l := info.State.Lost; l != nil && len(l.Msgs) > 0 {
		return api.StreamHealthError, fmt.Sprintf("%d messages were lost.", len(l.Msgs))
	}
	if info.Cluster != nil {
		for _, p := range info.Cluster.Replicas {
			switch {
			case p.Offline:
				return api.StreamHealthWarning, fmt.Sprintf("Replica %s is offline.", p.Name)
			case !p.Current:
				return api.StreamHealthWarning, fmt.Sprintf("Replica %s is %d operations behind.", p.Name, p.Lag)
			}
		}
	}
	return api.StreamHealthOK, ""
}

func sourceState(src *jsmapi.StreamSourceInfo) api.SourceState {
	st := api.SourceState{Name: src.Name, Filter: src.FilterSubject, Lag: src.Lag, Active: int64(src.Active)}
	if src.Error != nil {
		st.Error = src.Error.Description
	}
	return st
}

var errNoStream = errors.New("no such stream")

// loadStream refuses a name the server could never hold as a missing stream,
// not a server error.
func loadStream(a *contexts.Conn, name string) (*jsm.Stream, error) {
	if !jsm.IsValidName(name) {
		return nil, fmt.Errorf("%w: %q", errNoStream, name)
	}
	return a.JSM.LoadStream(name)
}

// writeStreamError answers 404 for a stream that does not exist.
func writeStreamError(w http.ResponseWriter, err error) {
	if errors.Is(err, errNoStream) || jsm.IsNatsError(err, 10059) { // JSStreamNotFoundErr
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	writeError(w, err)
}
