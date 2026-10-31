// Package live serves Natter's live feeds over one multiplexed WebSocket per
// browser tab. The browser subscribes to topics; each topic has one producer,
// shared by every subscribed tab and kept running while anyone listens.
package live

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	"github.com/CirXe0N/natter/internal/api"
)

// A Producer feeds one topic. Run emits encoded api.ServerFrames until ctx
// ends. A snapshot frame holds the whole state, so it supersedes every frame
// before it; any other frame only supersedes the previous one. Snapshot is
// the first frame a new subscriber gets, or nil.
type Producer interface {
	Run(ctx context.Context, emit func(frame []byte, snapshot bool))
	Snapshot() []byte
}

// Hub fans each topic's frames out to the subscribed clients.
type Hub struct {
	// Grace keeps a producer running after its last subscriber leaves, so a
	// page reload does not restart it and lose its history.
	Grace time.Duration
	// WriteTimeout disconnects a client that does not take a frame in time.
	WriteTimeout time.Duration

	topics  map[api.Topic]func() Producer
	mu      sync.Mutex
	running map[api.Topic]*running
}

type running struct {
	Producer
	stop context.CancelFunc
	subs map[*client]struct{}
	idle *time.Timer // set while subs is empty
}

// NewHub serves the given topics. Each producer is made on first subscribe.
func NewHub(topics map[api.Topic]func() Producer) *Hub {
	return &Hub{Grace: 5 * time.Second, WriteTimeout: 5 * time.Second, topics: topics, running: map[api.Topic]*running{}}
}

// Serve upgrades r to a WebSocket and runs it until either side closes.
// The upgrade refuses an Origin other than the request's own host or one
// matching originPatterns (coder/websocket's default check). Callers must
// check the session first.
func (h *Hub) Serve(w http.ResponseWriter, r *http.Request, originPatterns []string) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: originPatterns})
	if err != nil {
		return // Accept already answered
	}
	defer conn.CloseNow()
	// A hijacked request's context is not cancelled when the peer leaves; the
	// failing read below is what ends the connection.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	c := newClient()
	defer h.leave(c)
	go func() {
		c.write(ctx, conn, h.WriteTimeout) // returns on a write error, which closes conn
		conn.CloseNow()
	}()

	for {
		var f api.ClientFrame
		if err := wsjson.Read(ctx, conn, &f); err != nil {
			return
		}
		switch f.Op {
		case api.ClientOpSub:
			h.subscribe(c, f.Topic)
		case api.ClientOpUnsub:
			h.unsubscribe(c, f.Topic)
		}
	}
}

func (h *Hub) subscribe(c *client, t api.Topic) {
	h.mu.Lock()
	defer h.mu.Unlock()
	run := h.running[t]
	if run == nil {
		mk, ok := h.topics[t]
		if !ok {
			b, _ := json.Marshal(api.ServerFrame{Topic: t, Error: "unknown topic"})
			c.send(t, b, false)
			return
		}
		ctx, stop := context.WithCancel(context.Background())
		run = &running{Producer: mk(), stop: stop, subs: map[*client]struct{}{}}
		h.running[t] = run
		go run.Run(ctx, func(frame []byte, snapshot bool) { h.broadcast(run, t, frame, snapshot) })
	}
	if run.idle != nil {
		run.idle.Stop()
		run.idle = nil
	}
	run.subs[c] = struct{}{}
	if snap := run.Snapshot(); snap != nil {
		c.send(t, snap, true)
	}
}

func (h *Hub) unsubscribe(c *client, t api.Topic) {
	h.mu.Lock()
	defer h.mu.Unlock()
	c.drop(t)
	run := h.running[t]
	if run == nil {
		return
	}
	delete(run.subs, c)
	if len(run.subs) > 0 || run.idle != nil {
		return
	}
	var idle *time.Timer
	idle = time.AfterFunc(h.Grace, func() {
		h.mu.Lock()
		defer h.mu.Unlock()
		if run.idle == idle { // nobody subscribed since
			run.stop()
			delete(h.running, t)
		}
	})
	run.idle = idle
}

// leave unsubscribes a closed client from everything.
func (h *Hub) leave(c *client) {
	h.mu.Lock()
	var topics []api.Topic
	for t, run := range h.running {
		if _, ok := run.subs[c]; ok {
			topics = append(topics, t)
		}
	}
	h.mu.Unlock()
	for _, t := range topics {
		h.unsubscribe(c, t)
	}
}

func (h *Hub) broadcast(run *running, t api.Topic, frame []byte, snapshot bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range run.subs {
		c.send(t, frame, snapshot)
	}
}

// client is one WebSocket. Its queue holds at most two frames per topic,
// the newest snapshot and the newest update after it: every topic today is a
// metric, so a newer value replaces one not yet written.
type client struct {
	mu      sync.Mutex
	pending map[api.Topic]*slot
	kick    chan struct{} // 1-buffered: pending changed
}

type slot struct{ snapshot, update []byte }

func newClient() *client {
	return &client{pending: map[api.Topic]*slot{}, kick: make(chan struct{}, 1)}
}

func (c *client) send(t api.Topic, frame []byte, snapshot bool) {
	c.mu.Lock()
	s := c.pending[t]
	if s == nil {
		s = &slot{}
		c.pending[t] = s
	}
	if snapshot {
		s.snapshot, s.update = frame, nil
	} else {
		s.update = frame
	}
	c.mu.Unlock()
	select {
	case c.kick <- struct{}{}:
	default:
	}
}

// drop forgets frames not yet written, so an unsubscribed topic goes quiet.
func (c *client) drop(t api.Topic) {
	c.mu.Lock()
	delete(c.pending, t)
	c.mu.Unlock()
}

// take empties the queue.
func (c *client) take() map[api.Topic]*slot {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := c.pending
	c.pending = map[api.Topic]*slot{}
	return out
}

// write sends queued frames until ctx ends or a write fails. A write that
// misses its deadline fails, and coder/websocket then closes the connection.
func (c *client) write(ctx context.Context, conn *websocket.Conn, timeout time.Duration) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-c.kick:
		}
		for _, s := range c.take() {
			for _, frame := range [][]byte{s.snapshot, s.update} {
				if frame == nil {
					continue
				}
				wctx, cancel := context.WithTimeout(ctx, timeout)
				err := conn.Write(wctx, websocket.MessageText, frame)
				cancel()
				if err != nil {
					return
				}
			}
		}
	}
}
