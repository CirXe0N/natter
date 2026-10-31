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
		route{pattern: "GET /api/streams/{name}/consumers/{consumer}", handle: (*server).consumerDetail},
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

// pauseConsumer pauses until now + seconds; resume is the matching DELETE.
func (s *server) pauseConsumer(w http.ResponseWriter, r *http.Request) {
	var req api.ConsumerPause
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Seconds <= 0 {
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
