package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"sync"
	"time"

	"github.com/nats-io/jsm.go"
	jsmapi "github.com/nats-io/jsm.go/api"
	natsserver "github.com/nats-io/nats-server/v2/server"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"

	"github.com/CirXe0N/natter/internal/api"
	"github.com/CirXe0N/natter/internal/contexts"
	"github.com/CirXe0N/natter/internal/live"
)

// Browsing (ADR-0003): each open message table is a view that holds one
// ordered, headers_only consumer, except on WorkQueue and Interest streams,
// which are read with Direct Get (directPage). Both routes run under Read-only
// mode, the exception the glossary names for Browsing.
func init() {
	routes = append(routes,
		route{pattern: "POST /api/streams/{name}/messages", handle: (*server).browseMessages, allowReadOnly: true},
		route{pattern: "DELETE /api/browsing/{view}", handle: (*server).closeBrowsing, allowReadOnly: true},
	)
}

const (
	pageSize   = 100
	previewMax = 1024 // payloads up to this size get a preview in the table
)

// browseIdle closes a view that has had no page request for this long, in
// case the browser left without its DELETE. It is also the consumers'
// InactiveThreshold, so the server cleans up after a natter that died. Tests
// shorten it.
var browseIdle = 30 * time.Second

// nextWait is how long a page waits for a message NumPending promised.
var nextWait = 10 * time.Second

var validView = regexp.MustCompile(`^[A-Za-z0-9-]{1,64}$`)

type view struct {
	id   string
	mu   sync.Mutex
	idle *time.Timer
	gen  int // bumped per consumer, so a replacement never reuses a name

	js      jetstream.JetStream // the Context's client the consumer was made on
	stream  jetstream.Stream
	filter  string
	cons    jetstream.Consumer
	msgs    jetstream.MessagesContext
	next    uint64 // the Seq a request that continues the last page asks for
	pending uint64
}

func (s *server) browseMessages(w http.ResponseWriter, r *http.Request) {
	a := s.jetStream(w)
	if a == nil {
		return
	}
	name := r.PathValue("name")
	var req api.MessagePageRequest
	switch err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBody)).Decode(&req); {
	case !jsm.IsValidName(name):
		writeStreamError(w, fmt.Errorf("%w: %q", errNoStream, name))
		return
	case err != nil:
		http.Error(w, "bad JSON: "+err.Error(), http.StatusBadRequest)
		return
	case !validView.MatchString(req.View):
		http.Error(w, "view must be 1 to 64 letters, digits or dashes", http.StatusBadRequest)
		return
	case req.Filter != "" && !natsserver.IsValidSubject(req.Filter):
		http.Error(w, fmt.Sprintf("%q is not a valid subject filter.", req.Filter), http.StatusBadRequest)
		return
	}

	vv, _ := s.views.LoadOrStore(req.View, &view{id: req.View})
	v := vv.(*view)
	v.mu.Lock()
	defer v.mu.Unlock()
	s.views.Store(v.id, v) // a DELETE or the idle timer may have removed it while this request waited
	if v.idle == nil {
		v.idle = time.AfterFunc(browseIdle, func() {
			s.views.CompareAndDelete(v.id, v)
			v.mu.Lock()
			v.shut()
			v.mu.Unlock()
		})
	} else {
		v.idle.Reset(browseIdle)
	}

	page, err := v.page(r.Context(), a, name, req)
	if err != nil {
		v.shut() // its position is unknown now; the next request starts afresh
		var apiErr *jetstream.APIError
		switch {
		case errors.Is(err, jetstream.ErrStreamNotFound):
			http.Error(w, err.Error(), http.StatusNotFound)
		case errors.As(err, &apiErr) && apiErr.Code == http.StatusBadRequest:
			http.Error(w, apiErr.Description, http.StatusBadRequest)
		case errors.Is(err, errNoDirect):
			http.Error(w, err.Error(), http.StatusBadRequest)
		default:
			writeError(w, err)
		}
		return
	}
	writeJSON(w, page)
}

func (s *server) closeBrowsing(w http.ResponseWriter, r *http.Request) {
	if vv, ok := s.views.LoadAndDelete(r.PathValue("view")); ok {
		v := vv.(*view)
		v.mu.Lock()
		if v.idle != nil {
			v.idle.Stop()
		}
		v.shut()
		v.mu.Unlock()
	}
	w.WriteHeader(http.StatusNoContent)
}

// page reads up to 100 rows. It keeps the consumer when the request carries on
// from the last page, and replaces it on a jump, a filter change, another
// stream or a Context switch.
func (v *view) page(ctx context.Context, a *contexts.Conn, name string, req api.MessagePageRequest) (api.MessagePage, error) {
	if v.cons == nil || v.js != a.JS || v.stream.CachedInfo().Config.Name != name || v.filter != req.Filter || req.Time != nil || req.Seq != v.next {
		v.shut()
		st, err := a.JS.Stream(ctx, name)
		if err != nil {
			return api.MessagePage{}, err
		}
		// A WorkQueue stream refuses an AckNone consumer, and on an Interest
		// stream one holds messages until it reads them, then removes them
		// (TestBrowsingConsumerOnInterest). Both are listed with Direct Get.
		if st.CachedInfo().Config.Retention != jetstream.LimitsPolicy {
			return directPage(ctx, a, name, req)
		}
		if err := v.open(ctx, a.JS, st, req); err != nil {
			return api.MessagePage{}, err
		}
	}
	page := api.MessagePage{Messages: []api.MsgMeta{}}
	for v.pending > 0 && len(page.Messages) < pageSize {
		next, cancel := context.WithTimeout(ctx, nextWait)
		msg, err := v.msgs.Next(jetstream.NextContext(next))
		cancel()
		if errors.Is(err, context.DeadlineExceeded) && ctx.Err() == nil {
			v.pending = 0 // counted messages went away (purge, max age, workqueue ack) before we read them
			break
		}
		if err != nil {
			return page, err
		}
		meta, err := msg.Metadata()
		if err != nil {
			return page, err
		}
		h := msg.Headers()
		size, _ := strconv.Atoi(h.Get(nats.MsgSize))
		h.Del(nats.MsgSize) // headers_only adds it; count only the message's own
		page.Messages = append(page.Messages, api.MsgMeta{Seq: meta.Sequence.Stream, Subject: msg.Subject(), Time: meta.Timestamp, Size: size, Headers: len(h)})
		v.next, v.pending = meta.Sequence.Stream+1, meta.NumPending
	}
	page.Pending = v.pending
	v.preview(ctx, page.Messages)
	return page, nil
}

func (v *view) open(ctx context.Context, js jetstream.JetStream, st jetstream.Stream, req api.MessagePageRequest) error {
	threshold := browseIdle
	if limit := st.CachedInfo().Config.ConsumerLimits.InactiveThreshold; limit > 0 {
		threshold = min(threshold, limit)
	}
	v.gen++
	cfg := jetstream.OrderedConsumerConfig{
		HeadersOnly:       true,
		InactiveThreshold: threshold,
		NamePrefix:        fmt.Sprintf("%s%s_%d", natterConsumerPrefix, v.id, v.gen),
		Metadata:          map[string]string{"natter": "browsing"},
		MaxResetAttempts:  1, // the default retries forever, holding the view's lock
		DeliverPolicy:     jetstream.DeliverAllPolicy,
	}
	if req.Filter != "" {
		cfg.FilterSubjects = []string{req.Filter}
	}
	switch {
	case req.Time != nil:
		cfg.DeliverPolicy, cfg.OptStartTime = jetstream.DeliverByStartTimePolicy, req.Time
	case req.Seq > 0:
		cfg.DeliverPolicy, cfg.OptStartSeq = jetstream.DeliverByStartSequencePolicy, req.Seq
	}
	cons, err := st.OrderedConsumer(ctx, cfg)
	if err != nil {
		return err
	}
	msgs, err := cons.Messages(jetstream.PullMaxMessages(pageSize))
	if err != nil {
		_ = st.DeleteConsumer(ctx, cons.CachedInfo().Name)
		return err
	}
	v.js, v.stream, v.filter, v.cons, v.msgs = js, st, req.Filter, cons, msgs
	v.next, v.pending = req.Seq, cons.CachedInfo().NumPending
	return nil
}

// directMaxBytes caps the payload bytes of a Direct Get page. The server
// still sends one message of any size.
const directMaxBytes = 256 << 10

var errNoDirect = errors.New("Browsing a WorkQueue or Interest stream needs a direct get, which leaves its messages in place")

// directPage lists up to 100 rows with one batched Direct Get, which reads
// the stream without a consumer but transfers each payload.
func directPage(ctx context.Context, a *contexts.Conn, name string, req api.MessagePageRequest) (api.MessagePage, error) {
	// shortcut: jsm.go v0.5.1's DirectGet sends to $JS.API.DIRECT.GET.<stream> whatever the Manager's domain or prefix; send the request ourselves if such Contexts need it.
	if o := a.JS.Options(); o.APIPrefix != "" || o.Domain != "" {
		return api.MessagePage{}, fmt.Errorf("%w. Natter cannot send one over a JetStream domain or API prefix yet.", errNoDirect)
	}
	st, err := a.JSM.LoadStream(name)
	if err != nil {
		return api.MessagePage{}, err
	}
	if !st.DirectAllowed() {
		return api.MessagePage{}, fmt.Errorf("%w. Turn on Allow direct get in %s's config to browse it.", errNoDirect, name)
	}
	get := jsmapi.JSApiMsgGetRequest{Seq: max(req.Seq, 1), NextFor: req.Filter, Batch: pageSize, MaxBytes: directMaxBytes}
	if req.Time != nil {
		get.Seq, get.StartTime = 0, req.Time
	}
	rows := []api.MsgMeta{}
	pending, _, _, err := st.DirectGet(ctx, get, func(m *nats.Msg) {
		h := popAdded(m.Header, jetstream.StreamHeader, jetstream.SubjectHeader, jetstream.SequenceHeader, jetstream.TimeStampHeaer, "Nats-Num-Pending", "Nats-Last-Sequence")
		seq, _ := strconv.ParseUint(h[2], 10, 64)
		t, _ := time.Parse(time.RFC3339Nano, h[3])
		row := api.MsgMeta{Seq: seq, Subject: h[1], Time: t, Size: len(m.Data), Headers: len(m.Header)}
		if row.Size <= previewMax {
			row.Kind, row.Preview = classify(m.Data)
		}
		rows = append(rows, row)
	})
	if err != nil && err.Error() != "no messages found matching request" { // jsm.go's error for the 404 of an empty batch
		return api.MessagePage{}, err
	}
	return api.MessagePage{Messages: rows, Pending: pending, Direct: true}, nil
}

// popAdded removes the value a Direct Get appended to each key, which the
// message's own headers may hold too, and returns those values in order.
func popAdded(h nats.Header, keys ...string) []string {
	vals := make([]string, len(keys))
	for i, k := range keys {
		v := h[k]
		if len(v) == 0 {
			continue
		}
		vals[i] = v[len(v)-1]
		if len(v) > 1 {
			h[k] = v[:len(v)-1]
		} else {
			delete(h, k)
		}
	}
	return vals
}

// shut stops the iterator and deletes the consumer, because Stop leaves it on
// the server. A failed delete is left to the consumer's InactiveThreshold.
func (v *view) shut() {
	if v.cons == nil {
		return
	}
	v.msgs.Stop()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = v.stream.DeleteConsumer(ctx, v.cons.CachedInfo().Name)
	v.cons, v.msgs = nil, nil
}

// preview fetches the payloads of small messages with a Direct Get (or
// STREAM.MSG.GET when the stream does not allow direct), a few at a time.
func (v *view) preview(ctx context.Context, rows []api.MsgMeta) {
	var wg sync.WaitGroup
	slots := make(chan struct{}, 8)
	for i := range rows {
		if rows[i].Size > previewMax {
			continue
		}
		wg.Go(func() {
			slots <- struct{}{}
			defer func() { <-slots }()
			m, err := v.stream.GetMsg(ctx, rows[i].Seq)
			if err != nil {
				return // deleted since it was listed: the row keeps no preview
			}
			rows[i].Kind, rows[i].Preview = classify(m.Data)
		})
	}
	wg.Wait()
}

var classify = live.Classify // shared with the Live tail
