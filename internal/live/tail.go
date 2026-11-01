package live

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/nats-io/nats-server/v2/server"
	"github.com/nats-io/nats.go"
	"golang.org/x/time/rate"

	"github.com/CirXe0N/natter/internal/api"
	"github.com/CirXe0N/natter/internal/contexts"
)

const (
	tailRows   = 10_000
	tailBudget = 64 << 20 // bytes of payloads and headers held per tail
	tailRate   = 1_000    // messages per second kept
	tailEvery  = 250 * time.Millisecond
	// Pending limits of about 5 s at the rate cap. A bigger buffer only adds
	// latency, since the rate cap drops the excess anyway.
	tailPendingMsgs  = 5_000
	tailPendingBytes = 32 << 20
	tailPreviewMax   = 1024 // payloads up to this size get a preview
	tailPreview      = 256  // of at most this many bytes
)

// Tail is a Live tail: a core NATS subscription on Filter, on a connection
// of its own so a flood cannot stall the active connection's read loop.
//
// Rows go into a ring of tailRows. Their payloads and headers are held until
// they add up to Budget, then dropped oldest first; the rows stay. Row
// metadata is bounded by the ring, previews included.
type Tail struct {
	Filter string
	Budget int

	m     *contexts.Manager
	topic api.Topic
	limit *rate.Limiter

	mu       sync.Mutex
	rows     []tailRow
	next     uint64 // ID of the next row, at rows[next%tailRows]
	heldFrom uint64 // rows before it hold no payload
	held     int    // bytes held, at most Budget
	f        api.Tail
	recent   [4]uint64 // Received at each of the last 4 ticks, for Rate
	ticks    int
	sawDrops int    // the subscription's Dropped() last tick
	denied   string // a permissions violation, until the Context changes
	sentRows uint64 // first row ID not yet in a frame
	conn     *tailConn
}

type tailRow struct {
	api.TailRow
	header nats.Header
	data   []byte
}

func (r *tailRow) cost() int {
	n := len(r.data)
	for k, vs := range r.header {
		for _, v := range vs {
			n += len(k) + len(v)
		}
	}
	return n
}

type tailConn struct {
	ref    api.Ref
	nc     *nats.Conn // nil when the tail could not start; err says why
	sub    *nats.Subscription
	err    string
	closed atomic.Bool
}

func (c *tailConn) close() {
	if c != nil && c.nc != nil {
		c.closed.Store(true)
		c.nc.Close()
	}
}

// NewTail tails filter on the active Context of m.
func NewTail(filter string, m *contexts.Manager) *Tail {
	return &Tail{Filter: filter, Budget: tailBudget, m: m, topic: api.Topic(api.TopicTailPrefix + filter),
		limit: rate.NewLimiter(tailRate, tailRate), rows: make([]tailRow, tailRows), f: api.Tail{Rows: []api.TailRow{}}}
}

// Lossy makes the hub queue every frame: each one carries rows.
func (t *Tail) Lossy() {}

// Run follows the active Context and emits a frame every tailEvery.
func (t *Tail) Run(ctx context.Context, emit func([]byte, bool)) {
	tick := time.NewTicker(tailEvery)
	defer tick.Stop()
	defer func() { t.conn.close() }()
	for {
		t.follow(ctx)
		emit(t.frame(), false)
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}

// Snapshot is the counters without rows, so a tab that subscribes or resumes
// starts at current messages.
func (t *Tail) Snapshot() []byte {
	t.mu.Lock()
	f := t.f
	t.mu.Unlock()
	f.Rows = []api.TailRow{}
	b, _ := json.Marshal(api.ServerFrame{Topic: t.topic, Tail: &f})
	return b
}

// follow opens the tail's connection to the active Context, and moves it when
// the user switches. A tail that failed to start is retried only after a switch.
func (t *Tail) follow(ctx context.Context) {
	a := t.m.Active()
	c := t.conn
	var problem string
	switch {
	case a == nil || a.Status != api.ConnStatusConnected:
		c.close()
		c = nil
		problem = noAccess(a).Error()
	case c == nil || c.ref != a.Context.Ref:
		c.close()
		c = t.start(ctx, a.Context)
	}
	if c != nil {
		problem = c.err
		if c.nc != nil && !c.nc.IsConnected() {
			problem = "The tail lost its connection and is reconnecting."
		}
	}
	t.mu.Lock()
	if c != t.conn {
		t.sawDrops, t.denied = 0, ""
	}
	t.conn = c
	if t.denied != "" {
		problem = t.denied
	}
	t.f.Problem = problem
	t.mu.Unlock()
}

func (t *Tail) start(ctx context.Context, c api.Context) *tailConn {
	tc := &tailConn{ref: c.Ref}
	if !server.IsValidSubject(t.Filter) {
		tc.err = fmt.Sprintf("%q is not a valid subject filter. Use tokens separated by dots, with * for one token and > for the rest.", t.Filter)
		return tc
	}
	nc, err := t.m.Dial(ctx, c, nats.Name("Natter live tail"),
		nats.DisconnectErrHandler(func(_ *nats.Conn, err error) {
			if !tc.closed.Load() {
				t.disconnected(err)
			}
		}),
		nats.ErrorHandler(func(_ *nats.Conn, _ *nats.Subscription, err error) {
			if errors.Is(err, nats.ErrPermissionViolation) {
				t.mu.Lock()
				t.denied = fmt.Sprintf("This Context may not subscribe to %s: %v", t.Filter, err)
				t.mu.Unlock()
			}
		}))
	if err != nil {
		tc.err = fmt.Sprintf("Could not open the tail's connection: %v", err)
		return tc
	}
	sub, err := nc.Subscribe(t.Filter, t.add)
	if err == nil {
		err = sub.SetPendingLimits(tailPendingMsgs, tailPendingBytes)
	}
	if err != nil {
		nc.Close()
		tc.err = fmt.Sprintf("Could not subscribe to %s: %v", t.Filter, err)
		return tc
	}
	tc.nc, tc.sub = nc, sub
	return tc
}

func (t *Tail) disconnected(err error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.f.Disconnects++
	t.f.Disconnect = "connection closed"
	if err != nil {
		t.f.Disconnect = err.Error()
	}
}

// add is the subscription's callback. It never blocks: over the rate cap a
// message is only counted.
func (t *Tail) add(m *nats.Msg) {
	now := time.Now()
	t.mu.Lock()
	defer t.mu.Unlock()
	t.f.Received++
	if !t.limit.Allow() {
		t.f.RateDrops++
		return
	}
	row := tailRow{TailRow: api.TailRow{ID: t.next, Time: now, Subject: m.Subject, Reply: m.Reply, Size: len(m.Data), Headers: len(m.Header)}}
	if len(m.Data) <= tailPreviewMax {
		var p *string
		row.Kind, p = Classify(m.Data)
		if p != nil && len(*p) > tailPreview {
			s := strings.Clone(strings.ToValidUTF8((*p)[:tailPreview], ""))
			p = &s
		}
		row.Preview = p
	}
	row.header, row.data = m.Header, m.Data
	if row.Held = row.cost() <= t.Budget; !row.Held {
		row.header, row.data = nil, nil // bigger than the whole budget: keep only the row
	}

	slot := &t.rows[t.next%tailRows]
	if slot.Held {
		t.held -= slot.cost()
	}
	*slot = row
	t.held += row.cost()
	t.next++
	t.heldFrom = max(t.heldFrom, t.next-min(t.next, tailRows))
	for t.held > t.Budget {
		r := &t.rows[t.heldFrom%tailRows]
		if r.Held {
			t.held -= r.cost()
			r.header, r.data, r.Held = nil, nil, false
		}
		t.heldFrom++
	}
}

// frame is the rows since the last frame and the counters.
func (t *Tail) frame() []byte {
	t.mu.Lock()
	if c := t.conn; c != nil && c.sub != nil {
		if d, err := c.sub.Dropped(); err == nil && d > t.sawDrops {
			t.f.PendingDrops += uint64(d - t.sawDrops)
			t.f.Received += uint64(d - t.sawDrops)
			t.sawDrops = d
		}
	}
	t.f.Rate = t.f.Received - t.recent[t.ticks%len(t.recent)]
	t.recent[t.ticks%len(t.recent)] = t.f.Received
	t.ticks++
	t.f.HeldFrom = t.heldFrom
	f := t.f
	f.Rows = make([]api.TailRow, 0, t.next-max(t.sentRows, t.next-min(t.next, tailRows)))
	for id := max(t.sentRows, t.next-min(t.next, tailRows)); id < t.next; id++ {
		f.Rows = append(f.Rows, t.rows[id%tailRows].TailRow)
	}
	t.sentRows = t.next
	t.mu.Unlock()
	b, _ := json.Marshal(api.ServerFrame{Topic: t.topic, Tail: &f})
	return b
}

// Message is a held row with its headers and payload, or false once the
// payload is no longer held.
func (t *Tail) Message(id uint64) (api.TailMessage, bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	r := t.rows[id%tailRows]
	if id >= t.next || r.ID != id || !r.Held {
		return api.TailMessage{}, false
	}
	out := api.TailMessage{TailRow: r.TailRow, HeaderValues: r.header}
	out.Kind, out.Payload = Classify(r.data)
	return out, true
}

// Classify says what a payload holds, and gives it as text when it is JSON or
// text without control characters.
func Classify(b []byte) (api.MsgKind, *string) {
	s := string(b)
	switch {
	case len(b) > 0 && json.Valid(b):
		return api.MsgKindJSON, &s
	case utf8.Valid(b) && !strings.ContainsFunc(s, func(r rune) bool { return unicode.IsControl(r) && r != '\n' && r != '\r' && r != '\t' }):
		return api.MsgKindText, &s
	}
	return api.MsgKindBinary, nil
}
