package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync/atomic"
	"testing"
	"testing/fstest"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"

	"github.com/CirXe0N/natter/internal/api"
	"github.com/CirXe0N/natter/internal/contexts"
	"github.com/CirXe0N/natter/internal/natstest"
	"github.com/CirXe0N/natter/internal/vault"
)

func TestBrowsing(t *testing.T) {
	old := browseIdle
	browseIdle = time.Second
	t.Cleanup(func() { browseIdle = old })

	ns, err := natstest.Start(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(ns.Shutdown)
	nc, err := nats.Connect(ns.ClientURL(), nats.UserInfo("app", "app"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(nc.Close)
	js, _ := jetstream.New(nc)
	ctx := context.Background()
	orders, err := js.CreateStream(ctx, jetstream.StreamConfig{Name: "ORDERS", Subjects: []string{"orders.>"}})
	if err != nil {
		t.Fatal(err)
	}
	const published = 250
	for i := 1; i <= published; i++ {
		m := nats.NewMsg([]string{"orders.eu", "orders.us"}[i%2])
		m.Data = []byte(`{"n":1}`)
		switch i {
		case 3:
			m.Data = []byte{0, 1, 2}
		case 4:
			m.Data = []byte("plain text")
		case 5:
			m.Header.Set("A", "1")
			m.Header.Set("B", "2")
		case 7:
			m.Data = bytes.Repeat([]byte("a"), 100_000)
		}
		if _, err := js.PublishMsg(ctx, m); err != nil {
			t.Fatal(err)
		}
	}
	deleted := []uint64{10, 11, 12, 150}
	for _, seq := range deleted {
		if err := orders.DeleteMsg(ctx, seq); err != nil {
			t.Fatal(err)
		}
	}
	const stored = published - 4

	// A durable worker with a position, which Browsing must not move.
	worker, err := orders.CreateConsumer(ctx, jetstream.ConsumerConfig{Durable: "worker", AckPolicy: jetstream.AckExplicitPolicy})
	if err != nil {
		t.Fatal(err)
	}
	batch, _ := worker.Fetch(5)
	for m := range batch.Messages() {
		if err := m.DoubleAck(ctx); err != nil {
			t.Fatal(err)
		}
	}
	before, _ := worker.Info(ctx)

	var acks, created, gone atomic.Int32
	count := func(subj string, n *atomic.Int32) {
		if _, err := nc.Subscribe(subj, func(*nats.Msg) { n.Add(1) }); err != nil {
			t.Fatal(err)
		}
	}
	count("$JS.ACK.>", &acks)
	count("$JS.EVENT.ADVISORY.CONSUMER.CREATED.ORDERS.*", &created)
	count("$JS.EVENT.ADVISORY.CONSUMER.DELETED.ORDERS.*", &gone)
	nc.Flush()

	root := t.TempDir()
	if err := natstest.WriteContext(root, "app", map[string]string{"url": ns.ClientURL(), "user": "app", "password": "app"}); err != nil {
		t.Fatal(err)
	}
	m := contexts.New(root, vault.Open(t.TempDir()))
	t.Cleanup(m.Close)
	h := New(Config{Token: "tok", Port: 1, UI: fstest.MapFS{}, Contexts: m})
	var session *http.Cookie
	call := func(method, target, body string) (int, string) {
		r := httptest.NewRequest(method, target, strings.NewReader(body))
		r.Host = "localhost"
		if session != nil {
			r.AddCookie(session)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if c := w.Result().Cookies(); len(c) > 0 {
			session = c[0]
		}
		return w.Code, w.Body.String()
	}
	call("GET", "/launch?token=tok", "")
	if code, body := call("PUT", "/api/contexts/active", `{"source":"cli","name":"app"}`); code != 200 {
		t.Fatalf("connect: %d %s", code, body)
	}
	page := func(stream string, req api.MessagePageRequest) api.MessagePage {
		t.Helper()
		b, _ := json.Marshal(req)
		code, body := call("POST", "/api/streams/"+stream+"/messages", string(b))
		if code != 200 {
			t.Fatalf("page %+v: %d %s", req, code, body)
		}
		var p api.MessagePage
		if err := json.Unmarshal([]byte(body), &p); err != nil {
			t.Fatal(err)
		}
		return p
	}
	eventually := func(what string, ok func() bool) {
		t.Helper()
		for deadline := time.Now().Add(5 * time.Second); !ok(); time.Sleep(20 * time.Millisecond) {
			if time.Now().After(deadline) {
				t.Fatal(what)
			}
		}
	}
	consumers := func(stream string) []string {
		names := []string{}
		st, _ := js.Stream(ctx, stream)
		for n := range st.ListConsumers(ctx).Info() {
			names = append(names, n.Name)
		}
		return names
	}

	// Paging forward reads every stored message once, in order, past the gaps, on one consumer.
	const view = "view-a"
	var rows []api.MsgMeta
	next := uint64(0)
	for {
		p := page("ORDERS", api.MessagePageRequest{View: view, Seq: next})
		if len(p.Messages) > pageSize {
			t.Fatalf("a page of %d rows", len(p.Messages))
		}
		rows = append(rows, p.Messages...)
		if want := uint64(stored - len(rows)); p.Pending != want {
			t.Fatalf("pending %d after %d rows, want %d", p.Pending, len(rows), want)
		}
		if p.Pending == 0 {
			break
		}
		next = p.Messages[len(p.Messages)-1].Seq + 1
	}
	var seqs []uint64
	for _, r := range rows {
		seqs = append(seqs, r.Seq)
	}
	for seq := uint64(1); seq <= published; seq++ {
		if slices.Contains(deleted, seq) == slices.Contains(seqs, seq) {
			t.Fatalf("seq %d: deleted %v but listed %v", seq, slices.Contains(deleted, seq), slices.Contains(seqs, seq))
		}
	}
	if len(rows) != stored || !slices.IsSorted(seqs) {
		t.Fatalf("listed %d rows (want %d), sorted %v", len(rows), stored, slices.IsSorted(seqs))
	}
	eventually("one consumer for three pages", func() bool { return created.Load() == 1 })

	bySeq := map[uint64]api.MsgMeta{}
	for _, r := range rows {
		bySeq[r.Seq] = r
	}
	pv := func(r api.MsgMeta) string {
		if r.Preview == nil {
			return "<none>"
		}
		return *r.Preview
	}
	for seq, want := range map[uint64]struct {
		size, headers int
		kind          api.MsgKind
		preview       string
	}{
		1: {7, 0, api.MsgKindJSON, `{"n":1}`},
		3: {3, 0, api.MsgKindBinary, "<none>"},
		4: {10, 0, api.MsgKindText, "plain text"},
		5: {7, 2, api.MsgKindJSON, `{"n":1}`},
		7: {100_000, 0, "", "<none>"},
	} {
		r := bySeq[seq]
		if r.Size != want.size || r.Headers != want.headers || r.Kind != want.kind || pv(r) != want.preview {
			t.Errorf("seq %d: size %d headers %d kind %q preview %q, want %+v", seq, r.Size, r.Headers, r.Kind, pv(r), want)
		}
	}
	if r := bySeq[2]; r.Subject != "orders.eu" || r.Time.IsZero() {
		t.Errorf("seq 2: %+v", r)
	}

	// The live consumer is ordered, headers_only, never acks, and says it is Natter's.
	names := consumers("ORDERS")
	slices.Sort(names)
	if len(names) != 2 || !strings.HasPrefix(names[0], "natter_"+view+"_") || names[1] != "worker" {
		t.Fatalf("consumers %v", names)
	}
	info, err := orders.Consumer(ctx, names[0])
	if err != nil {
		t.Fatal(err)
	}
	c := info.CachedInfo().Config
	if !c.HeadersOnly || c.AckPolicy != jetstream.AckNonePolicy || c.InactiveThreshold != browseIdle || c.Metadata["natter"] != "browsing" {
		t.Fatalf("consumer config %+v", c)
	}

	// A jump to a sequence, a time, or a new filter replaces the consumer.
	if p := page("ORDERS", api.MessagePageRequest{View: view, Seq: 150}); p.Messages[0].Seq != 151 {
		t.Fatalf("jump into the gap at 150 starts at %d", p.Messages[0].Seq)
	}
	at := bySeq[100].Time
	if p := page("ORDERS", api.MessagePageRequest{View: view, Time: &at}); p.Messages[0].Seq != 100 {
		t.Fatalf("jump to the time of 100 starts at %d", p.Messages[0].Seq)
	}
	us := page("ORDERS", api.MessagePageRequest{View: view, Filter: "orders.us"})
	for _, r := range us.Messages {
		if r.Subject != "orders.us" {
			t.Fatalf("filter orders.us listed %s", r.Subject)
		}
	}
	if total := uint64(len(us.Messages)) + us.Pending; total != 124 { // odd seqs 1..249, less the deleted 11
		t.Fatalf("orders.us: %d messages", total)
	}
	eventually("a consumer per jump and filter", func() bool { return created.Load() == 4 && gone.Load() == 3 })
	if n := len(consumers("ORDERS")); n != 2 {
		t.Fatalf("%d consumers after replacing, want 2", n)
	}

	// Read-only mode still browses and closes.
	if code, body := call("PUT", "/api/contexts/cli/app/settings", `{"readOnly":true}`); code != 200 {
		t.Fatalf("lock: %d %s", code, body)
	}
	page("ORDERS", api.MessagePageRequest{View: view, Seq: 1})
	if code, _ := call("DELETE", "/api/browsing/"+view, ""); code != http.StatusNoContent {
		t.Fatalf("close: %d", code)
	}
	if names := consumers("ORDERS"); !slices.Equal(names, []string{"worker"}) {
		t.Fatalf("consumers after close: %v", names)
	}
	eventually("every created consumer deleted", func() bool { return gone.Load() == created.Load() })

	// A view whose browser vanished is closed when idle.
	page("ORDERS", api.MessagePageRequest{View: "view-b"})
	eventually("idle view closed", func() bool { return slices.Equal(consumers("ORDERS"), []string{"worker"}) })

	// Nothing was acknowledged, stored or moved.
	nc.Flush()
	if n := acks.Load(); n != 0 {
		t.Fatalf("%d acks", n)
	}
	after, _ := worker.Info(ctx)
	if after.Delivered.Stream != before.Delivered.Stream || after.AckFloor.Stream != before.AckFloor.Stream || after.NumPending != before.NumPending || after.NumAckPending != before.NumAckPending {
		t.Fatalf("worker moved: %+v -> %+v", before, after)
	}
	if st, _ := orders.Info(ctx); st.State.Msgs != stored {
		t.Fatalf("%d messages stored", st.State.Msgs)
	}

	// The InactiveThreshold is clamped to the stream's consumer limit.
	limited, err := js.CreateStream(ctx, jetstream.StreamConfig{Name: "LIMITED", Subjects: []string{"limited"}, ConsumerLimits: jetstream.StreamConsumerLimits{InactiveThreshold: 500 * time.Millisecond}})
	if err != nil {
		t.Fatal(err)
	}
	js.Publish(ctx, "limited", []byte("x"))
	page("LIMITED", api.MessagePageRequest{View: "view-c"})
	for c := range limited.ListConsumers(ctx).Info() {
		if c.Config.InactiveThreshold != 500*time.Millisecond {
			t.Fatalf("LIMITED consumer threshold %s", c.Config.InactiveThreshold)
		}
	}
	call("DELETE", "/api/browsing/view-c", "")

	for _, tc := range []struct {
		stream, body string
		want         int
	}{
		{"ORDERS", `{"view":"a.b"}`, 400},
		{"ORDERS", `{"view":"v","filter":"orders..x"}`, 400},
		{"NOPE", `{"view":"v"}`, 404},
		{"bad.name", `{"view":"v"}`, 404},
	} {
		if code, body := call("POST", "/api/streams/"+tc.stream+"/messages", tc.body); code != tc.want {
			t.Errorf("%s %s: %d %s, want %d", tc.stream, tc.body, code, body, tc.want)
		}
	}

	// Messages counted as pending but gone before they are read end the browse, not fail it.
	nextWait = 300 * time.Millisecond
	t.Cleanup(func() { nextWait = 10 * time.Second })
	purged, err := js.CreateStream(ctx, jetstream.StreamConfig{Name: "GONE", Subjects: []string{"gone.>"}})
	if err != nil {
		t.Fatal(err)
	}
	for range 1000 {
		if _, err := js.Publish(ctx, "gone.x", []byte("x")); err != nil {
			t.Fatal(err)
		}
	}
	p := page("GONE", api.MessagePageRequest{View: "view-gone"})
	if err := purged.Purge(ctx); err != nil {
		t.Fatal(err)
	}
	read := len(p.Messages)
	for p.Pending > 0 {
		p = page("GONE", api.MessagePageRequest{View: "view-gone", Seq: p.Messages[len(p.Messages)-1].Seq + 1})
		read += len(p.Messages)
		if len(p.Messages) == 0 {
			break
		}
	}
	if p.Pending != 0 || read >= 1000 {
		t.Fatalf("after a purge: read %d rows, pending %d, want the browse to end early", read, p.Pending)
	}

	// WorkQueue and Interest streams are listed with Direct Get: no consumer, nothing removed.
	work, err := js.CreateStream(ctx, jetstream.StreamConfig{Name: "WORK", Subjects: []string{"work.>"}, Retention: jetstream.WorkQueuePolicy, AllowDirect: true})
	if err != nil {
		t.Fatal(err)
	}
	for i := 1; i <= published; i++ {
		m := nats.NewMsg([]string{"work.a", "work.b"}[i%2])
		m.Data = []byte(`{"n":1}`)
		switch i {
		case 7:
			m.Data = bytes.Repeat([]byte("a"), 300_000) // over the page's max_bytes on its own
		case 8:
			m.Header.Set("A", "1")
			m.Header.Set("Nats-Sequence", "own")
		}
		if _, err := js.PublishMsg(ctx, m); err != nil {
			t.Fatal(err)
		}
	}
	if err := work.DeleteMsg(ctx, 150); err != nil {
		t.Fatal(err)
	}
	processor, err := work.CreateConsumer(ctx, jetstream.ConsumerConfig{Durable: "processor", AckPolicy: jetstream.AckExplicitPolicy})
	if err != nil {
		t.Fatal(err)
	}
	done, _ := processor.Fetch(5)
	for m := range done.Messages() {
		if err := m.DoubleAck(ctx); err != nil {
			t.Fatal(err)
		}
	}
	const queued = published - 5 - 1
	var workCreated atomic.Int32
	count("$JS.EVENT.ADVISORY.CONSUMER.CREATED.WORK.*", &workCreated)
	nc.Flush()
	acksBefore := acks.Load()
	procBefore, _ := processor.Info(ctx)

	first := page("WORK", api.MessagePageRequest{View: "view-w"})
	if len(first.Messages) != 2 || first.Messages[1].Seq != 7 || !first.Direct {
		t.Fatalf("first WORK page: %d rows, direct %v; want 6 and 7, cut by max_bytes", len(first.Messages), first.Direct)
	}
	wrows := first.Messages
	for p := first; p.Pending > 0; {
		p = page("WORK", api.MessagePageRequest{View: "view-w", Seq: p.Messages[len(p.Messages)-1].Seq + 1})
		if len(p.Messages) == 0 || len(p.Messages) > pageSize || !p.Direct {
			t.Fatalf("a WORK page of %d rows, direct %v", len(p.Messages), p.Direct)
		}
		wrows = append(wrows, p.Messages...)
		if want := uint64(queued - len(wrows)); p.Pending != want {
			t.Fatalf("WORK pending %d after %d rows, want %d", p.Pending, len(wrows), want)
		}
	}
	var wseqs []uint64
	wby := map[uint64]api.MsgMeta{}
	for _, r := range wrows {
		wseqs = append(wseqs, r.Seq)
		wby[r.Seq] = r
	}
	if len(wrows) != queued || wseqs[0] != 6 || slices.Contains(wseqs, 150) || !slices.IsSorted(wseqs) {
		t.Fatalf("WORK listed %d rows from %d, want %d from 6 without 150, in order", len(wrows), wseqs[0], queued)
	}
	if r := wby[6]; r.Subject != "work.a" || r.Time.IsZero() || r.Size != 7 || r.Headers != 0 || r.Kind != api.MsgKindJSON || pv(r) != `{"n":1}` {
		t.Errorf("WORK seq 6: %+v", r)
	}
	if r := wby[7]; r.Size != 300_000 || r.Preview != nil || r.Kind != "" {
		t.Errorf("WORK seq 7: size %d kind %q preview %q", r.Size, r.Kind, pv(r))
	}
	if r := wby[8]; r.Headers != 2 || r.Subject != "work.a" {
		t.Errorf("WORK seq 8: %d headers on %s, want its own 2 on work.a", r.Headers, r.Subject)
	}
	if p := page("WORK", api.MessagePageRequest{View: "view-w", Seq: 150}); p.Messages[0].Seq != 151 {
		t.Fatalf("WORK jump to 150 starts at %d", p.Messages[0].Seq)
	}
	wat := wby[100].Time
	if p := page("WORK", api.MessagePageRequest{View: "view-w", Time: &wat}); p.Messages[0].Seq != 100 {
		t.Fatalf("WORK jump to the time of 100 starts at %d", p.Messages[0].Seq)
	}
	b := page("WORK", api.MessagePageRequest{View: "view-w", Filter: "work.b"})
	for _, r := range b.Messages {
		if r.Subject != "work.b" {
			t.Fatalf("filter work.b listed %s", r.Subject)
		}
	}
	if total := uint64(len(b.Messages)) + b.Pending; total != 122 { // odd seqs 7..249
		t.Fatalf("work.b: %d messages", total)
	}
	if p := page("WORK", api.MessagePageRequest{View: "view-w", Seq: 10_000}); len(p.Messages) != 0 || p.Pending != 0 {
		t.Fatalf("past the end: %+v", p)
	}
	call("DELETE", "/api/browsing/view-w", "")
	nc.Flush()
	if st, _ := work.Info(ctx); st.State.Msgs != queued {
		t.Fatalf("WORK holds %d messages after browsing, want %d", st.State.Msgs, queued)
	}
	if n := workCreated.Load(); n != 0 || !slices.Equal(consumers("WORK"), []string{"processor"}) {
		t.Fatalf("browsing WORK created %d consumers, consumers now %v", n, consumers("WORK"))
	}
	procAfter, _ := processor.Info(ctx)
	if acks.Load() != acksBefore || procAfter.Delivered.Stream != procBefore.Delivered.Stream || procAfter.NumPending != procBefore.NumPending {
		t.Fatalf("browsing WORK acked or moved the processor: %+v -> %+v", procBefore, procAfter)
	}

	// On an Interest stream a message the worker acks is gone at once: Browsing holds nothing.
	interest, err := js.CreateStream(ctx, jetstream.StreamConfig{Name: "INTEREST", Subjects: []string{"interest.>"}, Retention: jetstream.InterestPolicy, AllowDirect: true})
	if err != nil {
		t.Fatal(err)
	}
	reader, err := interest.CreateConsumer(ctx, jetstream.ConsumerConfig{Durable: "reader", FilterSubject: "interest.a", AckPolicy: jetstream.AckExplicitPolicy})
	if err != nil {
		t.Fatal(err)
	}
	for range 10 {
		js.Publish(ctx, "interest.a", []byte("x"))
	}
	if p := page("INTEREST", api.MessagePageRequest{View: "view-i"}); len(p.Messages) != 10 || !p.Direct {
		t.Fatalf("INTEREST page: %d rows, direct %v", len(p.Messages), p.Direct)
	}
	read3, _ := reader.Fetch(3)
	for m := range read3.Messages() {
		m.DoubleAck(ctx)
	}
	js.Publish(ctx, "interest.b", []byte("nobody wants this"))
	if st, _ := interest.Info(ctx); st.State.Msgs != 7 {
		t.Fatalf("INTEREST holds %d messages while browsed, want 7", st.State.Msgs)
	}
	call("DELETE", "/api/browsing/view-i", "")

	// Direct Get needs allow_direct.
	if _, err := js.CreateStream(ctx, jetstream.StreamConfig{Name: "NODIRECT", Subjects: []string{"nodirect"}, Retention: jetstream.WorkQueuePolicy}); err != nil {
		t.Fatal(err)
	}
	if code, body := call("POST", "/api/streams/NODIRECT/messages", `{"view":"view-n"}`); code != 400 || !strings.Contains(body, "Allow direct get") {
		t.Fatalf("NODIRECT: %d %s", code, body)
	}
}

// TestBrowsingConsumerOnInterest is why Interest streams are listed with Direct
// Get: a Browsing consumer on one holds messages every other consumer acked,
// and keeps ones nobody else wants, until it reads them.
func TestBrowsingConsumerOnInterest(t *testing.T) {
	ns, err := natstest.Start(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(ns.Shutdown)
	nc, err := nats.Connect(ns.ClientURL(), nats.UserInfo("app", "app"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(nc.Close)
	js, _ := jetstream.New(nc)
	ctx := context.Background()
	st, err := js.CreateStream(ctx, jetstream.StreamConfig{Name: "I", Subjects: []string{"i.>"}, Retention: jetstream.InterestPolicy})
	if err != nil {
		t.Fatal(err)
	}
	stored := func() uint64 { i, _ := st.Info(ctx); return i.State.Msgs }
	w, err := st.CreateConsumer(ctx, jetstream.ConsumerConfig{Durable: "w", FilterSubject: "i.a", AckPolicy: jetstream.AckExplicitPolicy})
	if err != nil {
		t.Fatal(err)
	}
	for range 10 {
		js.Publish(ctx, "i.a", []byte("x"))
	}
	ack := func(n int) {
		b, _ := w.Fetch(n)
		for m := range b.Messages() {
			m.DoubleAck(ctx)
		}
	}
	ack(3)
	if n := stored(); n != 7 {
		t.Fatalf("%d stored after w acked 3 of 10", n)
	}

	v := &view{id: "probe"}
	if err := v.open(ctx, js, st, api.MessagePageRequest{}); err != nil {
		t.Fatal(err)
	}
	v.msgs.Stop() // the consumer stays, not yet having read anything
	ack(3)
	js.Publish(ctx, "i.b", []byte("only the browser wants this"))
	if n := stored(); n != 8 {
		t.Fatalf("%d stored with a Browsing consumer, want 8: the 3 w acked and the i.b one held", n)
	}
	v.shut()
	if n := stored(); n != 4 {
		t.Fatalf("%d stored once the consumer is gone, want 4", n)
	}
}
