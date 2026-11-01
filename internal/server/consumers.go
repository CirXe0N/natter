package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/nats-io/jsm.go"
	jsmapi "github.com/nats-io/jsm.go/api"

	"github.com/CirXe0N/natter/internal/api"
	"github.com/CirXe0N/natter/internal/contexts"
)

func init() {
	routes = append(routes,
		route{pattern: "GET /api/streams/{name}/consumers", handle: (*server).listConsumers},
		route{pattern: "POST /api/streams/{name}/consumers", handle: (*server).createConsumer},
		route{pattern: "GET /api/streams/{name}/consumers/{consumer}", handle: (*server).consumerDetail},
		route{pattern: "PUT /api/streams/{name}/consumers/{consumer}", handle: (*server).updateConsumer},
		route{pattern: "PUT /api/streams/{name}/consumers/{consumer}/pause", handle: (*server).pauseConsumer},
		route{pattern: "DELETE /api/streams/{name}/consumers/{consumer}/pause", handle: (*server).resumeConsumer},
		route{pattern: "DELETE /api/streams/{name}/consumers/{consumer}", handle: (*server).deleteConsumer},
	)
}

// natterConsumerPrefix names the browsing consumers Natter creates itself.
const natterConsumerPrefix = "natter_"

// listConsumers pages through $JS.API.CONSUMER.LIST with jsm.go.
func (s *server) listConsumers(w http.ResponseWriter, r *http.Request) {
	a := s.jetStream(w)
	if a == nil {
		return
	}
	name := r.PathValue("name")
	if !jsm.IsValidName(name) {
		writeStreamError(w, fmt.Errorf("%w: %q", errNoStream, name))
		return
	}
	cs, _, offline, err := a.JSM.Consumers(name)
	if err != nil {
		writeStreamError(w, err)
		return
	}
	list := api.ConsumerList{Consumers: []api.ConsumerSummary{}, Offline: map[string]string{}}
	for _, c := range cs {
		info, err := c.LatestState() // the list response already carried it
		if err != nil {
			writeError(w, err)
			return
		}
		list.Consumers = append(list.Consumers, summarizeConsumer(&info))
	}
	for n, reason := range offline {
		list.Offline[n] = reason
	}
	writeJSON(w, list)
}

func (s *server) consumerDetail(w http.ResponseWriter, r *http.Request) {
	c := s.loadConsumer(w, r)
	if c == nil {
		return
	}
	info, err := c.State() // fresh INFO, not the cached one
	if err != nil {
		writeConsumerError(w, err)
		return
	}
	cfg, err := json.Marshal(info.Config)
	if err != nil {
		writeError(w, err)
		return
	}
	d := api.ConsumerDetail{
		ConsumerSummary: summarizeConsumer(&info),
		Stream:          info.Stream,
		Created:         info.Created,
		Delivered:       api.ConsumerSequence{Consumer: info.Delivered.Consumer, Stream: info.Delivered.Stream},
		AckFloor:        api.ConsumerSequence{Consumer: info.AckFloor.Consumer, Stream: info.AckFloor.Stream},
		PushBound:       info.PushBound,
		Config:          cfg,
	}
	if cl := info.Cluster; cl != nil {
		d.Cluster, d.Leader = cl.Name, cl.Leader
	}
	writeJSON(w, d)
}

// decodeConsumerConfig reads a consumer config in the server's own JSON
// shape. Unknown keys are refused so a typo cannot be silently dropped.
func decodeConsumerConfig(w http.ResponseWriter, r *http.Request) (cfg jsmapi.ConsumerConfig, ok bool) {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBody))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&cfg); err != nil {
		writeConsumerFieldError(w, fmt.Errorf("The consumer config is not valid JSON: %w", err), "")
		return cfg, false
	}
	return cfg, true
}

// createConsumer refuses a name in use: the server's create is create-or-update,
// so without the check a typo'd "new" consumer would silently rewrite one.
func (s *server) createConsumer(w http.ResponseWriter, r *http.Request) {
	a := s.jetStream(w)
	if a == nil {
		return
	}
	stream := r.PathValue("name")
	if !jsm.IsValidName(stream) {
		writeStreamError(w, fmt.Errorf("%w: %q", errNoStream, stream))
		return
	}
	cfg, ok := decodeConsumerConfig(w, r)
	if !ok {
		return
	}
	if cfg.Name == "" {
		writeConsumerFieldError(w, errors.New("A consumer needs a name."), "name")
		return
	}
	if cfg.Durable != "" && cfg.Durable != cfg.Name {
		writeConsumerFieldError(w, errors.New("A durable consumer's durable_name must be its name."), "name")
		return
	}
	if jsm.IsValidName(cfg.Name) {
		known, err := a.JSM.IsKnownConsumer(stream, cfg.Name)
		if err != nil {
			writeConsumerError(w, err)
			return
		}
		if known {
			writeConsumerFieldError(w, fmt.Errorf("A consumer named %q already exists on %s.", cfg.Name, stream), "name")
			return
		}
	}
	c, err := a.JSM.NewConsumerFromDefault(stream, cfg)
	if err != nil {
		writeConsumerFieldError(w, err)
		return
	}
	s.writeConsumer(w, c)
}

// updateConsumer sends the whole new config. The server refuses changes to
// the fields fixed at create (deliver and ack policy, push or pull…).
func (s *server) updateConsumer(w http.ResponseWriter, r *http.Request) {
	a := s.jetStream(w)
	if a == nil {
		return
	}
	old := loadConsumer(w, a, r.PathValue("name"), r.PathValue("consumer"))
	if old == nil {
		return
	}
	cfg, ok := decodeConsumerConfig(w, r)
	if !ok {
		return
	}
	if cfg.Name != old.Name() || (cfg.Durable != "" && cfg.Durable != old.Name()) {
		writeConsumerFieldError(w, errors.New("A consumer cannot be renamed."), "name")
		return
	}
	c, err := a.JSM.NewConsumerFromDefault(old.StreamName(), cfg)
	if err != nil {
		writeConsumerFieldError(w, err)
		return
	}
	s.writeConsumer(w, c)
}

// consumerFieldHints maps words in a refusal to the consumer config key it is
// about, first match wins, as fieldHints does for streams.
var consumerFieldHints = []struct{ word, field string }{
	{"already in use", "name"}, {"already exists", "name"}, {"durable", "name"},
	{"deliver policy", "deliver_policy"}, {"deliver_policy", "deliver_policy"},
	{"start sequence", "opt_start_seq"}, {"opt_start_seq", "opt_start_seq"},
	{"start time", "opt_start_time"}, {"opt_start_time", "opt_start_time"},
	{"ack policy", "ack_policy"}, {"ack_policy", "ack_policy"},
	{"ack wait", "ack_wait"}, {"ack_wait", "ack_wait"},
	{"replay", "replay_policy"},
	{"heart", "idle_heartbeat"}, {"flow control", "flow_control"}, {"flow_control", "flow_control"},
	{"push", "deliver_subject"}, {"pull", "deliver_subject"},
	{"max waiting", "max_waiting"}, {"max_waiting", "max_waiting"},
	{"backoff", "backoff"}, {"max deliver", "max_deliver"}, {"max_deliver", "max_deliver"},
	{"max ack pending", "max_ack_pending"}, {"max_ack_pending", "max_ack_pending"},
	{"deliver subject", "deliver_subject"}, {"deliver_subject", "deliver_subject"},
	{"deliver group", "deliver_group"}, {"deliver_group", "deliver_group"}, {"queue", "deliver_group"},
	{"filter", "filter_subjects"},
	{"inactive", "inactive_threshold"},
	{"replicas", "num_replicas"}, {"storage", "mem_storage"},
	{"batch", "max_batch"}, {"expires", "max_expires"}, {"max_expires", "max_expires"},
	{"max bytes", "max_bytes"}, {"max_bytes", "max_bytes"},
	{"priority group", "priority_groups"}, {"priority_groups", "priority_groups"}, {"pinned", "priority_timeout"}, {"priority", "priority_policy"},
	{"rate limit", "rate_limit_bps"}, {"rate_limit", "rate_limit_bps"},
	{"metadata", "metadata"}, {"description", "description"}, {"sample", "sample_freq"},
	{"name", "name"},
}

func writeConsumerFieldError(w http.ResponseWriter, err error, field ...string) {
	if jsm.IsNatsError(err, 10014) { // JSConsumerNotFoundErr
		writeConsumerError(w, err)
		return
	}
	writeHintedError(w, err, consumerFieldHints, field...)
}

// pauseConsumer pauses until now + seconds; resume is the matching DELETE.
func (s *server) pauseConsumer(w http.ResponseWriter, r *http.Request) {
	var req api.ConsumerPause
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBody)).Decode(&req); err != nil || req.Seconds <= 0 {
		http.Error(w, "Send {\"seconds\": n} with n above 0.", http.StatusBadRequest)
		return
	}
	c := s.loadConsumer(w, r)
	if c == nil {
		return
	}
	if _, err := c.Pause(time.Now().Add(time.Duration(req.Seconds) * time.Second)); err != nil {
		writeConsumerError(w, err)
		return
	}
	s.writeConsumer(w, c)
}

func (s *server) resumeConsumer(w http.ResponseWriter, r *http.Request) {
	c := s.loadConsumer(w, r)
	if c == nil {
		return
	}
	if err := c.Resume(); err != nil {
		writeConsumerError(w, err)
		return
	}
	s.writeConsumer(w, c)
}

func (s *server) deleteConsumer(w http.ResponseWriter, r *http.Request) {
	c := s.loadConsumer(w, r)
	if c == nil {
		return
	}
	if err := c.Delete(); err != nil {
		writeConsumerError(w, err)
		return
	}
	writeJSON(w, struct{}{})
}

// writeConsumer answers a mutation with the consumer's fresh summary.
func (s *server) writeConsumer(w http.ResponseWriter, c *jsm.Consumer) {
	info, err := c.State()
	if err != nil {
		writeConsumerError(w, err)
		return
	}
	writeJSON(w, summarizeConsumer(&info))
}

// loadConsumer answers 409 or 404 itself and returns nil when it cannot load.
func (s *server) loadConsumer(w http.ResponseWriter, r *http.Request) *jsm.Consumer {
	a := s.jetStream(w)
	if a == nil {
		return nil
	}
	return loadConsumer(w, a, r.PathValue("name"), r.PathValue("consumer"))
}

func loadConsumer(w http.ResponseWriter, a *contexts.Conn, stream, name string) *jsm.Consumer {
	if !jsm.IsValidName(stream) {
		writeStreamError(w, fmt.Errorf("%w: %q", errNoStream, stream))
		return nil
	}
	if !jsm.IsValidName(name) {
		writeConsumerError(w, fmt.Errorf("%w: %q", errNoConsumer, name))
		return nil
	}
	c, err := a.JSM.LoadConsumer(stream, name)
	if err != nil {
		writeConsumerError(w, err)
		return nil
	}
	return c
}

var errNoConsumer = errors.New("no such consumer")

// writeConsumerError answers 404 for a missing stream or consumer.
func writeConsumerError(w http.ResponseWriter, err error) {
	if errors.Is(err, errNoConsumer) || jsm.IsNatsError(err, 10014) { // JSConsumerNotFoundErr
		http.Error(w, "No such consumer.", http.StatusNotFound)
		return
	}
	writeStreamError(w, err)
}

func summarizeConsumer(info *jsmapi.ConsumerInfo) api.ConsumerSummary {
	c := info.Config
	filter := c.FilterSubjects
	if c.FilterSubject != "" {
		filter = append([]string{c.FilterSubject}, filter...)
	}
	if filter == nil {
		filter = []string{}
	}
	sum := api.ConsumerSummary{
		Name:        info.Name,
		Natter:      strings.HasPrefix(info.Name, natterConsumerPrefix),
		Durable:     c.Durable != "",
		Push:        c.DeliverSubject != "",
		Filter:      filter,
		AckPolicy:   strings.ToLower(c.AckPolicy.String()),
		Pending:     info.NumPending,
		AckPending:  info.NumAckPending,
		Redelivered: info.NumRedelivered,
		Waiting:     info.NumWaiting,
		Paused:      info.Paused,
		LastActive:  info.Delivered.Last,
	}
	if last := info.AckFloor.Last; last != nil && (sum.LastActive == nil || last.After(*sum.LastActive)) {
		sum.LastActive = last
	}
	if info.Paused {
		until := c.PauseUntil
		sum.PauseUntil = &until
	}
	return sum
}
