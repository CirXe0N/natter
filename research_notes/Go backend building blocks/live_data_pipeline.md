# Live-data and large-message pipeline in the nats-ui Go backend

Scope: how the single Go binary turns NATS (nats-server v2.15.2, nats.go v1.55.0) into the WebSocket feeds described in [ADR-0003](../../docs/adr/0003-browsing-large-messages.md) and the glossary terms **Browsing** and **Live tail**. All source was read from tagged checkouts made on 2026-10-31:

- nats-server `v2.15.2`: `https://github.com/nats-io/nats-server/blob/v2.15.2/server/…`
- nats.go `v1.55.0` (the newest v1.55.x tag found by `git ls-remote`): `https://github.com/nats-io/nats.go/blob/v1.55.0/…`
- natscli `v0.5.1`: `https://github.com/nats-io/natscli/blob/v0.5.1/cli/…`
- jsm.go `main` @ `74725ff`: `https://github.com/nats-io/jsm.go/blob/74725fff877cf26c1b57591e3d1b2b39b424c037/…`
- NATS ADRs `main` @ `dc0b1c7`: `https://github.com/nats-io/nats-architecture-and-design/blob/dc0b1c7200f0d716fdee9de1428759594538ed7d/adr/…`

Line numbers refer to those exact revisions.

## 1. Paging a stream by sequence with an ephemeral, headers-only ordered consumer

### Takeaway
Use **one nats.go `OrderedConsumer` per open table view**, read with `Messages()`/`Next()`, and **do not use `Fetch()` for paging**. Each ordered `Fetch()` call recreates the server consumer, and every consumer create or delete in a cluster is a meta-layer Raft proposal. Recreate the consumer only when the user jumps to a new sequence or time, or changes the filter. Set `InactiveThreshold` to about 30 s so a dead backend's consumers are reaped quickly. Sequence and timestamp come from the JetStream ack reply subject (`msg.Metadata()`), and the payload size comes from the `Nats-Msg-Size` header. "Leaves no trace" holds for data and for other consumers' positions. It does **not** hold for audit visibility, because creates and deletes publish advisories. Ordered consumers also **cannot be used on WorkQueue streams**.

### Cited Findings
**What the server does with headers_only / ephemeral / inactive_threshold**
- `ConsumerConfig` has `HeadersOnly` (`headers_only`), `InactiveThreshold` (`inactive_threshold`), `MemoryStorage` (`mem_storage`), `FlowControl` and `Heartbeat` (`idle_heartbeat`). — [consumer.go L107-L126](https://github.com/nats-io/nats-server/blob/v2.15.2/server/consumer.go#L107-L126)
- On delivery, if `HeadersOnly` is set the server calls `convertToHeadersOnly`. That function drops the payload and appends a `Nats-Msg-Size: <len(payload)>` header. — [consumer.go L5510-L5511](https://github.com/nats-io/nats-server/blob/v2.15.2/server/consumer.go#L5510-L5511), [consumer.go L5774-L5790](https://github.com/nats-io/nats-server/blob/v2.15.2/server/consumer.go#L5774-L5790), constant `JSMsgSize = "Nats-Msg-Size"` at [stream.go L750](https://github.com/nats-io/nats-server/blob/v2.15.2/server/stream.go#L750)
- Ephemerals always get an inactive threshold. If none is given, the server stamps `JsDeleteWaitTimeDefault` (5 s) and adds 100 ms plus up to 900 ms of jitter. An explicit threshold on a pull consumer also gets the jitter, while push consumers use the exact value. — [consumer.go L600](https://github.com/nats-io/nats-server/blob/v2.15.2/server/consumer.go#L600), [consumer.go L1515-L1532](https://github.com/nats-io/nats-server/blob/v2.15.2/server/consumer.go#L1515-L1532)
- If the consumer omits `InactiveThreshold`, it inherits the stream's `ConsumerLimits.InactiveThreshold`. A requested threshold above the stream limit is rejected (`NewJSConsumerInactiveThresholdExcessError`). — [consumer.go L690-L695](https://github.com/nats-io/nats-server/blob/v2.15.2/server/consumer.go#L690-L695), [consumer.go L871-L872](https://github.com/nats-io/nats-server/blob/v2.15.2/server/consumer.go#L871-L872)
- `deleteNotActive` runs only on the consumer leader. For pull consumers it first checks for still-valid waiting pull requests and re-arms the timer if there are any (expiring them updates "last activity"). Otherwise it deletes once `time.Since(o.waiting.last) >= dthresh`. Push consumers are only checked for `o.active` (interest on the delivery subject). — [consumer.go L2234-L2280](https://github.com/nats-io/nats-server/blob/v2.15.2/server/consumer.go#L2234-L2280)
- Pull consumers on a `WorkQueuePolicy` stream must not use `AckNone`. The server returns `NewJSConsumerPullRequiresAckError`. — [consumer.go L836-L839](https://github.com/nats-io/nats-server/blob/v2.15.2/server/consumer.go#L836-L839)
- The server publishes consumer create and delete advisories (`sendCreateAdvisory`, `sendDeleteAdvisoryLocked`) on `$JS.EVENT.ADVISORY.CONSUMER.CREATED…`. — [consumer.go L2025](https://github.com/nats-io/nats-server/blob/v2.15.2/server/consumer.go#L2025), [consumer.go L2081](https://github.com/nats-io/nats-server/blob/v2.15.2/server/consumer.go#L2081), [jetstream_api.go L299](https://github.com/nats-io/nats-server/blob/v2.15.2/server/jetstream_api.go#L299)

**Per-page cost of create/delete**
- In clustered mode, `jsConsumerCreateRequest` hands off to `jsClusteredConsumerRequest`, which ends with `cc.meta.Propose(cc.term, encodeAddConsumerAssignment(ca))`. Every consumer creation, R1 memory ephemerals included, is a meta-leader Raft proposal. — [jetstream_api.go L5001](https://github.com/nats-io/nats-server/blob/v2.15.2/server/jetstream_api.go#L5001), [L5204](https://github.com/nats-io/nats-server/blob/v2.15.2/server/jetstream_api.go#L5204); [jetstream_cluster.go L12390](https://github.com/nats-io/nats-server/blob/v2.15.2/server/jetstream_cluster.go#L12390), [L12756](https://github.com/nats-io/nats-server/blob/v2.15.2/server/jetstream_cluster.go#L12756)

**What nats.go's ordered consumer actually creates**
- `orderedConsumer.getConsumerConfig()` builds the config: name `<prefix>_<serial>`, `DeliverByStartSequencePolicy` with `OptStartSeq = cursor+1` (or the user's `OptStartSeq`, or 1), `AckNonePolicy`, `InactiveThreshold: 5 * time.Minute` unless the user overrides it, `Replicas: 1`, `MemoryStorage: true`, and the user's `HeadersOnly`. One filter goes in `FilterSubject` and several go in `FilterSubjects`. For `DeliverByStartTimePolicy` it uses `OptStartTime` and clears `OptStartSeq`. — [jetstream/ordered.go L583-L640](https://github.com/nats-io/nats.go/blob/v1.55.0/jetstream/ordered.go#L583-L640)
- `OrderedConsumerConfig` exposes `FilterSubjects`, `DeliverPolicy`, `OptStartSeq`, `OptStartTime`, `ReplayPolicy`, `InactiveThreshold`, `HeadersOnly`, `MaxResetAttempts` and `Metadata`. — [jetstream/consumer_config.go L283-L327](https://github.com/nats-io/nats.go/blob/v1.55.0/jetstream/consumer_config.go#L283-L327)
- `reset()` stops the current subscription and **deletes the old server consumer asynchronously** (`go … c.js.DeleteConsumer(ctx 10s)`). It then creates a new one with backoff from 1 s up to 10 s. `MaxResetAttempts == 0` means unlimited (-1). — [jetstream/ordered.go L532-L560](https://github.com/nats-io/nats.go/blob/v1.55.0/jetstream/ordered.go#L532-L560), [L599-L601](https://github.com/nats-io/nats.go/blob/v1.55.0/jetstream/ordered.go#L599-L601)
- `orderedConsumer.Fetch()` calls `c.reset()` on **every** call, so each Fetch is a delete plus a create. The nats.go doc comment on `FetchBytes` states that it "will reset the consumer for each subsequent Fetch call. Consider using [Consumer.Consume] or [Consumer.Messages] instead." Concurrent Fetch/Consume/Messages on one ordered consumer returns `ErrOrderedConsumerConcurrentRequests`. — [jetstream/ordered.go L419-L478](https://github.com/nats-io/nats.go/blob/v1.55.0/jetstream/ordered.go#L419-L478), [L84-L93](https://github.com/nats-io/nats.go/blob/v1.55.0/jetstream/ordered.go#L84-L93), [L244-L251](https://github.com/nats-io/nats.go/blob/v1.55.0/jetstream/ordered.go#L244-L251)
- ADR-17 (ordered consumer) requires `ack_policy` none, `mem_storage` true, `num_replicas` 1, and recreation from the last known stream sequence on gaps or missed heartbeats. — [ADR-17.md L19-L53](https://github.com/nats-io/nats-architecture-and-design/blob/dc0b1c7200f0d716fdee9de1428759594538ed7d/adr/ADR-17.md#L19-L53)

**Metadata (timestamp, stream sequence)**
- `jetstream.MsgMetadata` has `Sequence{Stream, Consumer}`, `NumDelivered`, `NumPending`, `Timestamp`, `Stream`, `Consumer` and `Domain`. These are parsed from the `$JS.ACK.…` reply-subject tokens, with the timestamp read as Unix nanoseconds. — [jetstream/message.go L91-L115](https://github.com/nats-io/nats.go/blob/v1.55.0/jetstream/message.go#L91-L115), [L321-L329](https://github.com/nats-io/nats.go/blob/v1.55.0/jetstream/message.go#L321-L329)

**Reference implementation: natscli `stream view` / jsm.go pager**
- natscli `stream view` uses `jsm.StreamPager` with `PagerSize`, `PagerStartId` and `PagerFilterSubject`. — [natscli stream_command.go L1244-L1255](https://github.com/nats-io/natscli/blob/v0.5.1/cli/stream_command.go#L1244-L1255)
- jsm.go's pager creates a **durable** consumer named `stream_pager_<pid><nanos>` with `InactiveThreshold(time.Hour)`, memory storage, R1, a start sequence or start-time delta, and a filter. It deletes the consumer on `close()`. It is therefore not a model for "no trace": a crashed CLI leaves a durable for up to an hour. — [jsm.go stream_pager.go L259-L290](https://github.com/nats-io/jsm.go/blob/74725fff877cf26c1b57591e3d1b2b39b424c037/stream_pager.go#L259-L290), [L292-L305](https://github.com/nats-io/jsm.go/blob/74725fff877cf26c1b57591e3d1b2b39b424c037/stream_pager.go#L292-L305)

### Inferences
- **Per view, not per page.** A 100-row page via `Fetch()` costs two meta-layer proposals (async delete plus create) and a consumer-info round trip, every page. Recommended model: one `OrderedConsumer` per open view, driven with `Messages()` and `Next()`, pulling exactly `pageSize` rows and then idling. Scrolling forward continues the same consumer. A jump (to a sequence, a time, the end, or a new filter) calls `Stop()` and then creates a new ordered consumer with `OptStartSeq`/`OptStartTime`. Backward pages are a jump to `max(first, topSeq-pageSize)`. Sequence gaps mean a page can be short, so loop until 100 rows arrive or `NumPending == 0`.
- **Cleanup guarantee.** When the view closes, call `Stop()` and then explicitly `DeleteConsumer(ctx, stream, cachedInfo.Name)`. Ordered `Stop()` does not delete synchronously (only `reset()` deletes, and that is fire-and-forget). If the backend dies, pull-mode reaping waits until the last pull request has expired and `InactiveThreshold` (+0.1–1 s jitter) has passed. The bound is therefore roughly `pull expiry + InactiveThreshold + 1 s`. Pick `InactiveThreshold: 30 * time.Second` (not nats.go's default 5 min) and keep pull expiries short. Streams with a `ConsumerLimits.InactiveThreshold` smaller than ours reject the create, so clamp to the stream limit after reading `StreamInfo`.
- **"Browsing leaves no trace"** holds on these points: AckNone (no ack state), memory storage (no on-disk consumer state), ephemeral (auto-deleted), and no change to other consumers' positions. Caveats to document:
  1. On **WorkQueue** streams the AckNone pull consumer is rejected (L836-L839). Fall back to Direct Get batches with `no_hdr=false` and small `max_bytes`, or show sizes from `StreamInfo` only. (Inference: listing a WorkQueue stream via a consumer with acks would remove messages, so it must never be done.)
  2. Every consumer create and delete emits an advisory and a meta-log entry, so auditors and `nats consumer ls` will see `nats-ui` activity. Give consumers a recognisable `Metadata`/name prefix (e.g. `nats_ui_view_`).
  3. Gap: on **Interest** retention streams, whether an extra AckNone consumer affects retention was not verified in source. Treat it as a risk to test (see Gaps).
- Code sketch (one view):

```go
type View struct {
    js     jetstream.JetStream
    stream string
    cons   jetstream.Consumer
    it     jetstream.MessagesContext
}

func (v *View) Open(ctx context.Context, filters []string, startSeq uint64, startTime *time.Time) error {
    cfg := jetstream.OrderedConsumerConfig{
        FilterSubjects:    filters,
        HeadersOnly:       true,
        InactiveThreshold: 30 * time.Second,
        MaxResetAttempts:  5,
        Metadata:          map[string]string{"created_by": "nats-ui"},
    }
    switch {
    case startTime != nil:
        cfg.DeliverPolicy, cfg.OptStartTime = jetstream.DeliverByStartTimePolicy, startTime
    case startSeq > 0:
        cfg.DeliverPolicy, cfg.OptStartSeq = jetstream.DeliverByStartSequencePolicy, startSeq
    }
    c, err := v.js.OrderedConsumer(ctx, v.stream, cfg)
    if err != nil { return err }
    it, err := c.Messages(jetstream.PullMaxMessages(100)) // small buffer; we stop pulling when page is full
    if err != nil { return err }
    v.cons, v.it = c, it
    return nil
}

type Row struct {
    Seq     uint64
    Time    time.Time
    Subject string
    Size    int64            // from Nats-Msg-Size
    Headers nats.Header
}

func (v *View) Page(ctx context.Context, n int) ([]Row, bool, error) {
    rows := make([]Row, 0, n)
    for len(rows) < n {
        m, err := v.it.Next(jetstream.NextContext(ctx)) // ctx with ~2s deadline
        if err != nil { return rows, true, err }        // deadline => end of stream for now
        md, _ := m.Metadata()
        size, _ := strconv.ParseInt(m.Headers().Get("Nats-Msg-Size"), 10, 64)
        rows = append(rows, Row{md.Sequence.Stream, md.Timestamp, m.Subject(), size, m.Headers()})
        if md.NumPending == 0 { return rows, true, nil }
    }
    return rows, false, nil
}

func (v *View) Close(ctx context.Context) {
    v.it.Stop()
    if ci := v.cons.CachedInfo(); ci != nil {
        _ = v.js.DeleteConsumer(ctx, v.stream, ci.Name) // explicit; don't rely on InactiveThreshold
    }
}
```

### Gaps
- Not measured: the latency of a meta-layer consumer proposal on a 3-node cluster. Expect it to be bounded by a Raft round trip to the meta leader, but no benchmark was found.
- Not verified in source: whether an AckNone ephemeral on an `InterestPolicy` stream changes message retention (for example whether its interest keeps messages until delivery). This needs an integration test before Browsing is enabled on interest streams.
- Not verified: whether `Messages()` keeps a pull request outstanding while idle (that would delay the inactive reaping noted above). Read `jetstream/pull.go` heartbeat and expiry defaults if exact numbers are needed.

## 2. Direct Get for opening a message, and streaming multi-MB payloads to the browser

### Takeaway
Direct Get requires `allow_direct: true` on the stream. When it is enabled, every stream peer (and opted-in mirrors) answers from its local store via a queue group, so reads can be **slightly stale** on followers. nats.go's `Stream.GetMsg` uses Direct Get automatically when the cached `StreamInfo` says `AllowDirect`, and otherwise falls back to the leader-only `STREAM.MSG.GET`. A message arrives as one NATS message (it is never chunked by NATS), so the backend holds exactly one `[]byte` and writes slices of it to the WebSocket or HTTP response. That is one buffer, with no second copy.

### Cited Findings
- `StreamConfig.AllowDirect` ("allow higher performance, direct access to get individual messages") and `MirrorDirect` ("unified direct access for mirrors"). — [stream.go L79-L83](https://github.com/nats-io/nats-server/blob/v2.15.2/server/stream.go#L79-L83)
- With `AllowDirect`, the stream queue-subscribes `$JS.API.DIRECT.GET.<stream>` and `$JS.API.DIRECT.GET.<stream>.>` (last-by-subject) in group `dgetGroup`. — [stream.go L5276-L5310](https://github.com/nats-io/nats-server/blob/v2.15.2/server/stream.go#L5276-L5310), subjects at [jetstream_api.go L105-L109](https://github.com/nats-io/nats-server/blob/v2.15.2/server/jetstream_api.go#L105-L109)
- **R3 behaviour:** clustered followers subscribe to Direct Get only once they are current, **or at least 90 % caught up** under heavy load ("enabling direct gets at %.0f%% synchronized"). — [jetstream_cluster.go L4800-L4825](https://github.com/nats-io/nats-server/blob/v2.15.2/server/jetstream_cluster.go#L4800-L4825)
- ADR-31: Direct Get lets "all stream peers (R>1), not just the stream leader" respond as a queue group from their local store. The older `MSG.GET` API routes to the leader with administrative overhead. — [ADR-31.md L20-L36](https://github.com/nats-io/nats-architecture-and-design/blob/dc0b1c7200f0d716fdee9de1428759594538ed7d/adr/ADR-31.md#L20-L36)
- **Mirrors:** a mirror's `mirror_direct` makes its peers join the upstream's Direct Get queue group. It is auto-set to match the upstream's `allow_direct` when the upstream is visible. A mirror subscribes only once it is fewer than `dgetCaughtUpThresh = 10` messages behind. — [ADR-31.md L40-L63](https://github.com/nats-io/nats-architecture-and-design/blob/dc0b1c7200f0d716fdee9de1428759594538ed7d/adr/ADR-31.md#L40-L63), [stream.go L734](https://github.com/nats-io/nats-server/blob/v2.15.2/server/stream.go#L734), [stream.go L3584-L3590](https://github.com/nats-io/nats-server/blob/v2.15.2/server/stream.go#L3584-L3590), [stream.go L2218-L2228](https://github.com/nats-io/nats-server/blob/v2.15.2/server/stream.go#L2218-L2228)
- Request shape `JSApiMsgGetRequest`: `seq`, `last_by_subj`, `next_by_subj`, `batch`, `max_bytes`, `start_time`, `multi_last`, `up_to_seq`, `up_to_time`, `no_hdr`. — [jetstream_api.go L825-L847](https://github.com/nats-io/nats-server/blob/v2.15.2/server/jetstream_api.go#L825-L847)
- Errors come back as status headers (`408 Empty Request`, `408 Bad Request`, `404 Message Not Found`, `412 Required Api Level`). Requests arriving over routes, gateways or leafnodes are queued instead of served inline. — [stream.go L6096-L6146](https://github.com/nats-io/nats-server/blob/v2.15.2/server/stream.go#L6096-L6146), [stream.go L6323-L6400](https://github.com/nats-io/nats-server/blob/v2.15.2/server/stream.go#L6323-L6400)
- Batch `max_bytes` defaults to the server's `max_pending`. ADR-31 says batches are sent "without any flow control" and end with a `204 EOB` message carrying `Nats-Num-Pending` and `Nats-Last-Sequence`. — [stream.go L6357-L6363](https://github.com/nats-io/nats-server/blob/v2.15.2/server/stream.go#L6357-L6363), [ADR-31.md L155-L161](https://github.com/nats-io/nats-architecture-and-design/blob/dc0b1c7200f0d716fdee9de1428759594538ed7d/adr/ADR-31.md#L155-L161)
- nats.go `stream.GetMsg` checks the cached `info.Config.AllowDirect`. If true it requests `DIRECT.GET.<stream>`, otherwise `STREAM.MSG.GET.<stream>`. — [jetstream/stream.go L549-L600](https://github.com/nats-io/nats.go/blob/v1.55.0/jetstream/stream.go#L549-L600), [jetstream/api.go L96-L100](https://github.com/nats-io/nats.go/blob/v1.55.0/jetstream/api.go#L96-L100)
- **Size limits:** default `max_payload` is 1 MB (`MAX_PAYLOAD_SIZE`). The server warns above 8 MB (`MAX_PAYLOAD_MAX_SIZE`). — [const.go L92-L99](https://github.com/nats-io/nats-server/blob/v2.15.2/server/const.go#L92-L99), [server.go L2385-L2387](https://github.com/nats-io/nats-server/blob/v2.15.2/server/server.go#L2385-L2387). Stream `max_msg_size` defaults to `MAX_PAYLOAD_SIZE` in one validation path. — [stream.go L1574](https://github.com/nats-io/nats-server/blob/v2.15.2/server/stream.go#L1574)

### Inferences
- **Consistency for the UI:** after the user publishes and immediately opens the message, a follower may return `404`. Retry once without Direct Get (`STREAM.MSG.GET` hits the leader). An alternative is to accept a short delay: Direct Get gives no read-after-write guarantee on followers (inferred from the 90 % rule above).
- **Max size:** a stored message cannot exceed the `max_payload` in force when it was published, and the Direct Get reply is that same message plus headers. The UI should read `max_payload` from the connection's INFO (`nc.MaxPayload()`) instead of assuming 1 MB, as ADR-0003 already says.
- **One buffer, chunked out:** NATS delivers the whole payload in one `nats.Msg.Data`. There is no partial read, so "buffer once" means: keep `raw.Data`, never `json.Marshal` it into an envelope (base64 would grow it by 33 % and copy it), and write sub-slices. Over WebSocket, send a small JSON header frame first and then binary frames of 64 KB each. The browser shows the first frame immediately (ADR-0003's "first 64 KB"). Over HTTP, `GET /api/streams/{s}/msgs/{seq}/payload` with `Content-Length`, `Range` support via `http.ServeContent(w, r, "", ts, bytes.NewReader(raw.Data))`, and `Content-Disposition: attachment` for downloads. `bytes.Reader` adds no copy. Suggested split: an HTTP endpoint for "load full" and download (the browser streams to disk, and ranged requests give the 64 KB preview for free); WebSocket only for the metadata envelope.

```go
func (h *API) payload(w http.ResponseWriter, r *http.Request) {
    seq, _ := strconv.ParseUint(r.PathValue("seq"), 10, 64)
    s, err := h.js.Stream(r.Context(), r.PathValue("stream")) // cached StreamInfo drives Direct vs MSG.GET
    if err != nil { httpErr(w, err); return }
    raw, err := s.GetMsg(r.Context(), seq)
    if errors.Is(err, jetstream.ErrMsgNotFound) { // follower lag: retry on leader
        raw, err = h.leaderGet(r.Context(), r.PathValue("stream"), seq) // raw $JS.API.STREAM.MSG.GET.<stream> {"seq":N}
    }
    if err != nil { httpErr(w, err); return }
    w.Header().Set("X-Nats-Subject", raw.Subject)
    w.Header().Set("Content-Type", "application/octet-stream")
    http.ServeContent(w, r, "", raw.Time, bytes.NewReader(raw.Data)) // handles Range: bytes=0-65535
}

// WebSocket variant: header frame + 64 KiB binary frames from the same slice.
func streamPayload(ctx context.Context, c *websocket.Conn, id string, data []byte) error {
    const chunk = 64 << 10
    for off := 0; off < len(data); off += chunk {
        end := min(off+chunk, len(data))
        if err := c.Write(ctx, websocket.MessageBinary, frame(id, off, data[off:end])); err != nil { return err }
    }
    return nil
}
```
(`leaderGet` is our own helper: `nc.Request("$JS.API.STREAM.MSG.GET."+stream, {"seq":N})`, which decodes the JSON `message` (base64 `data`). The JSON/base64 path costs one extra copy, so use it only for this rare retry.)

### Gaps
- Not verified: whether `jetstream.GetMsgOpt` offers a supported way to force the non-direct path in v1.55.0. The fallback above should be a raw request.
- The WebSocket library API (`coder/websocket` `Conn.Write`/`Conn.Writer`, `http.ServeContent` Range handling) was not read from source in this session. Check the [coder/websocket docs](https://pkg.go.dev/github.com/coder/websocket) and [net/http ServeContent](https://pkg.go.dev/net/http#ServeContent).
- Not verified in source: whether a client-side `MaxPayload` limits **receiving** large messages in nats.go. Inference: the client limit is enforced on publish only.

## 3. Live tail from core NATS: slow consumers, drop counting, memory-budgeted ring buffer

### Takeaway
Subscribe with a **callback** subscription (not `ChanSubscribe`, whose limit is fixed to `cap(ch)` and cannot be changed). Set modest pending limits with `SetPendingLimits` so nats.go drops for us under overload, and read `sub.Dropped()` deltas for the "dropped" counter, as natscli `sub` does. Rate-cap at 1,000/s with a token bucket in the callback and count rate-cap drops separately. Store rows in a fixed-capacity ring of 10,000 entries plus a byte budget: evict payloads oldest-first when over budget, and keep the row with `PayloadHeld=false`.

### Cited Findings
- Default per-subscription pending limits: `DefaultSubPendingMsgsLimit = 500_000` and `DefaultSubPendingBytesLimit = 64 MB`. For channel subscriptions the message limit is `cap(ch)`. — [nats.go L5945-L5948](https://github.com/nats-io/nats.go/blob/v1.55.0/nats.go#L5945-L5948), [nats.go L5210-L5224](https://github.com/nats-io/nats.go/blob/v1.55.0/nats.go#L5210-L5224)
- `SetPendingLimits(msgLimit, bytesLimit)` returns `ErrTypeSubscription` for `ChanSubscription` and `ErrInvalidArg` for 0. Negative means unlimited, and natscli bench calls `SetPendingLimits(-1, -1)`. — [nats.go L5972-L5988](https://github.com/nats-io/nats.go/blob/v1.55.0/nats.go#L5972-L5988), [natscli bench_command.go L2408](https://github.com/nats-io/natscli/blob/v0.5.1/cli/bench_command.go#L2408)
- When the limits are exceeded, nats.go **drops** the message: `sub.dropped++`, the stats reservation is released, and **only on the first transition** into slow-consumer state does it set `nc.err = ErrSlowConsumer` and fire `AsyncErrorCB(nc, sub, ErrSlowConsumer)`. The client keeps reading, so this is drop, not block. — [nats.go L4119-L4150](https://github.com/nats-io/nats.go/blob/v1.55.0/nats.go#L4119-L4150), error text at [nats.go L119](https://github.com/nats-io/nats.go/blob/v1.55.0/nats.go#L119)
- `Dropped()` "returns the number of known dropped messages… by violations of PendingLimits. If the server declares the connection a SlowConsumer, this number may not be valid." — [nats.go L6004-L6019](https://github.com/nats-io/nats.go/blob/v1.55.0/nats.go#L6004-L6019)
- natscli `sub` computes its drop counter as `counter += dropped - lastDropped[sub]`, called per received message. — [natscli sub_command.go L128-L142](https://github.com/nats-io/natscli/blob/v0.5.1/cli/sub_command.go#L128-L142), [L449](https://github.com/nats-io/natscli/blob/v0.5.1/cli/sub_command.go#L449)
- The server also counts slow consumers (`slow_consumers`, `slow_consumer_stats` in STATSZ), which is a different, server-side mechanism. — [events.go L367-L392](https://github.com/nats-io/nats-server/blob/v2.15.2/server/events.go#L367-L392)

### Inferences
- **Never block in the NATS callback.** Blocking backs up the client read loop for the whole connection (this inference fits the design: messages are queued per sub, and the server then sees the connection as slow and may disconnect it). Use a **dedicated `*nats.Conn` for live tails** so a misbehaving tail cannot stall Browsing, KV watches or STATSZ.
- Three drop sources, reported separately and summed for the UI's "dropped N": (a) client pending-limit drops (`Dropped()` delta, plus a flag when `ErrSlowConsumer` fires), (b) rate-cap drops (counted by us), (c) server-side slow-consumer disconnects (watch `DisconnectErrHandler`, and say the count is unknown).
- Pending limits for a 1,000/s tail: `SetPendingLimits(5_000, 64<<20)`, so about 5 s of burst before dropping. Bigger buffers only add latency because the rate cap drops the excess anyway.
- **Memory-budgeted ring:** a fixed array of `cap` rows (no allocation per message after warm-up for the metadata). Payloads are owned `[]byte` (nats.go reuses no buffers for callback messages, but copy anyway if the message might be retained by a pooled path). Eviction happens in two cases: when a row is overwritten (ring wrap), its payload bytes are subtracted. While `held > budget`, a `payloadTail` cursor advances from the oldest row and nils out payloads. That is O(1) amortised, because the cursor only moves forward.

```go
type TailRow struct {
    ID          uint64 // monotonically increasing, used by clients as cursor
    Time        time.Time
    Subject     string
    Reply       string
    Headers     nats.Header
    Size        int
    Payload     []byte // nil when evicted
    PayloadHeld bool
}

type Tail struct {
    mu         sync.Mutex
    rows       []TailRow // len == capacity (10_000)
    next       uint64    // ID of next row; rows[id % cap]
    held       int       // bytes of payload currently held
    budget     int       // e.g. 256 << 20
    evictFrom  uint64    // oldest ID that may still hold a payload
    limiter    *rate.Limiter // golang.org/x/time/rate, 1000/s, burst 1000
    rateDrops, lastSubDrops, subDrops uint64
    notify     func(TailRow) // hands off to the fan-out hub (non-blocking)
}

func (t *Tail) onMsg(m *nats.Msg) {
    if d, err := m.Sub.Dropped(); err == nil { // natscli-style delta
        t.mu.Lock(); t.subDrops += uint64(d) - t.lastSubDrops; t.lastSubDrops = uint64(d); t.mu.Unlock()
    }
    if !t.limiter.Allow() { atomic.AddUint64(&t.rateDrops, 1); return }
    t.add(m)
}

func (t *Tail) add(m *nats.Msg) {
    t.mu.Lock()
    defer t.mu.Unlock()
    c := uint64(len(t.rows))
    slot := &t.rows[t.next%c]
    if slot.PayloadHeld { t.held -= len(slot.Payload) } // overwritten on wrap
    *slot = TailRow{ID: t.next, Time: time.Now(), Subject: m.Subject, Reply: m.Reply,
        Headers: m.Header, Size: len(m.Data), Payload: m.Data, PayloadHeld: true}
    t.held += len(m.Data)
    t.next++
    if t.evictFrom+c < t.next { t.evictFrom = t.next - c }
    for t.held > t.budget && t.evictFrom < t.next-1 { // keep at least the newest payload
        r := &t.rows[t.evictFrom%c]
        if r.PayloadHeld { t.held -= len(r.Payload); r.Payload, r.PayloadHeld = nil, false }
        t.evictFrom++
    }
    t.notify(*slot) // copy of metadata; hub decides whether to send payload preview
}
```
- A single message larger than the whole budget should be stored with `PayloadHeld=false` (or truncated to a preview), so one 8 MB publish cannot evict every other payload. This is a policy choice for the ADR.
- Reference patterns: `golang.org/x/time/rate` for the cap. Go's `container/ring` is a linked ring and allocates per element, so a slice-indexed ring as above is cheaper. (Both are design inferences, not verified in source this session.)

### Gaps
- No primary source was read for the server-side slow-consumer thresholds (`max_pending`, `write_deadline`) or for the effect on the whole connection. Look at `client.go` `flushOutbound`/`handleWriteTimeout` in nats-server v2.15.2 if exact behaviour is needed.
- nats.go's buffer ownership for `nats.Msg.Data` in callback subscriptions (whether it is safe to retain without copying) was not verified in source in this session.

## 4. Fan-out to multiple tabs and WebSocket clients with per-client backpressure

### Takeaway
Use one NATS-side producer per distinct resource (tail filter, open stream view, KV bucket, metrics), and a hub that fans out to per-client **bounded send queues**. The hub never blocks. For each feed type, a slow client gets **drop-oldest plus a "gap" marker** (tail), **coalescing to latest** (metrics, KV key state), or **disconnect** (when the queue stays full past a deadline). No primary NATS source covers this, so it is a design recommendation built from the NATS-side patterns above.

### Cited Findings
- The pattern NATS itself uses for client-side overload is bounded pending plus drop plus a one-shot notification plus a counter. It is described in Q3. — [nats.go L4119-L4150](https://github.com/nats-io/nats.go/blob/v1.55.0/nats.go#L4119-L4150), [nats.go L6004-L6019](https://github.com/nats-io/nats.go/blob/v1.55.0/nats.go#L6004-L6019)
- natscli `server watch` deduplicates by server and redraws a summary instead of printing every event, which is a coalescing display. — [natscli server_watch_srv_command.go L101-L126](https://github.com/nats-io/natscli/blob/v0.5.1/cli/server_watch_srv_command.go#L101-L126)

### Inferences
- Shape:

```go
type Client struct {
    out     chan []byte      // bounded, e.g. 256 frames
    latest  sync.Map         // coalescing slots: key -> []byte (metrics, kv key)
    kick    chan struct{}    // 1-buffered "latest has changed"
    dropped atomic.Uint64
}

// Tail rows: drop-oldest, then tell the client how many it missed.
func (c *Client) sendLossy(frame []byte) {
    select {
    case c.out <- frame:
    default:
        select { case <-c.out: c.dropped.Add(1) ; default: } // drop oldest
        select { case c.out <- frame: default: c.dropped.Add(1) }
    }
}

// Metrics / KV state: overwrite, never queue more than one per key.
func (c *Client) sendLatest(key string, frame []byte) {
    c.latest.Store(key, frame)
    select { case c.kick <- struct{}{}: default: }
}

func (c *Client) writer(ctx context.Context, ws *websocket.Conn) error {
    tick := time.NewTicker(250 * time.Millisecond) // also batches tail rows
    defer tick.Stop()
    for {
        select {
        case f := <-c.out:
            if err := writeWithTimeout(ctx, ws, f, 5*time.Second); err != nil { return err } // timeout => disconnect
        case <-c.kick:
            c.latest.Range(func(k, v any) bool { c.latest.Delete(k); _ = writeWithTimeout(ctx, ws, v.([]byte), 5*time.Second); return true })
        case <-tick.C:
            if n := c.dropped.Swap(0); n > 0 { _ = writeWithTimeout(ctx, ws, gapFrame(n), 5*time.Second) }
        case <-ctx.Done():
            return ctx.Err()
        }
    }
}
```
- **Batch tail rows**: send a frame of up to N rows every 100–250 ms instead of one frame per message. At 1,000 msgs/s that is 4–10 frames/s per client. Send **metadata plus a short preview only**, and fetch the full payload over HTTP by row ID (from the ring), as in Q2.
- **Late-joining tab:** on subscribe, the hub replays the ring snapshot (metadata only) and then switches to live. Use row `ID` as a resume cursor so a reconnecting tab asks for `since=ID`.
- **Reference counting:** the NATS subscription or ordered consumer lives while ≥1 client is attached. Close it after a short grace period (5 s) so a page reload does not churn consumers (relevant given the meta-proposal cost in Q1).
- Per-client write deadlines make a stalled tab disconnect instead of growing memory. Total memory per client is bounded by `cap(out) × max frame size`.

### Gaps
- No primary NATS source covers WebSocket fan-out. The coder/websocket and gorilla/websocket concurrency rules (one concurrent writer per conn for gorilla) should be checked in their docs: [coder/websocket](https://pkg.go.dev/github.com/coder/websocket), [gorilla/websocket concurrency](https://pkg.go.dev/github.com/gorilla/websocket#hdr-Concurrency).

## 5. `$SYS.SERVER.*.STATSZ`: interval, payload, cluster aggregation, ring buffers

### Takeaway
The STATSZ broadcast interval is **10 s at steady state** and is **not configurable**: it is an unexported package variable. It starts at 250 ms and doubles up to 10 s, with extra sends on JetStream, gateway and reload events, and the broadcast subject is rate-limited to at most one per second. For **1-second points**, the backend must **poll** `$SYS.REQ.SERVER.PING.STATSZ` every second (every server replies) and also subscribe to `$SYS.SERVER.*.STATSZ`. Counters are cumulative, so the backend derives rates from deltas. An hour of 1 s points is 3,600 slots per series, and a fixed `[3600]float32` ring per server per metric costs about 14 KB.

### Cited Findings
- `serverStatsSubj = "$SYS.SERVER.%s.STATSZ"`. Request subjects are `$SYS.REQ.SERVER.PING.%s` (use `.STATSZ`), the legacy `$SYS.REQ.SERVER.PING`, and per-server `$SYS.REQ.SERVER.%s.%s`. — [events.go L66-L69](https://github.com/nats-io/nats-server/blob/v2.15.2/server/events.go#L66-L69), handlers at [events.go L1271-L1277](https://github.com/nats-io/nats-server/blob/v2.15.2/server/events.go#L1271-L1277)
- `var statsHBInterval = 10 * time.Second` (the line above it reads `// FIXME(dlc) - make configurable.`, attached to `eventsHBInterval`), with `defaultStatszRateLimit = 1 * time.Second`. — [events.go L99-L107](https://github.com/nats-io/nats-server/blob/v2.15.2/server/events.go#L99-L107), used at [server.go L1899](https://github.com/nats-io/nats-server/blob/v2.15.2/server/server.go#L1899)
- Timer behaviour: it starts at 250 ms, doubles on each heartbeat until it reaches `statsz` (10 s), and sends in a goroutine. `limitStatsz` limits **only the broadcast subject** to `min(statszRateLimit, cstatsz)`. — [events.go L1091-L1119](https://github.com/nats-io/nats-server/blob/v2.15.2/server/events.go#L1091-L1119), [events.go L1122-L1154](https://github.com/nats-io/nats-server/blob/v2.15.2/server/events.go#L1122-L1154)
- Extra out-of-band `sendStatszUpdate()` calls come from JetStream, gateway and config-reload paths. — [jetstream.go L2765](https://github.com/nats-io/nats-server/blob/v2.15.2/server/jetstream.go#L2765), [L2786](https://github.com/nats-io/nats-server/blob/v2.15.2/server/jetstream.go#L2786), [gateway.go L932](https://github.com/nats-io/nats-server/blob/v2.15.2/server/gateway.go#L932), [reload.go L2114](https://github.com/nats-io/nats-server/blob/v2.15.2/server/reload.go#L2114)
- `statszReq`: with a reply subject it answers there, so the rate limit does not apply. A request with no reply makes it broadcast after resetting the limiter. The request body can carry `EventFilterOptions` (`server_name`, `cluster`, `host`, `exact_match`, `tags`, `domain`). — [events.go L2239-L2263](https://github.com/nats-io/nats-server/blob/v2.15.2/server/events.go#L2239-L2263), [events.go L1995-L2002](https://github.com/nats-io/nats-server/blob/v2.15.2/server/events.go#L1995-L2002)
- Payload `ServerStatsMsg{server: ServerInfo, statsz: ServerStats}`. — [events.go L150-L153](https://github.com/nats-io/nats-server/blob/v2.15.2/server/events.go#L150-L153)
  - `ServerInfo`: `name, host, id, cluster, domain, ver, tags, metadata, feature_flags, jetstream, flags, seq, time`. — [events.go L249-L266](https://github.com/nats-io/nats-server/blob/v2.15.2/server/events.go#L249-L266)
  - `ServerStats`: `start, mem, cores, cpu, connections, total_connections, active_accounts, subscriptions, sent, sent_to_clients, received, received_from_clients, slow_consumers, slow_consumer_stats, stale_connections, stale_connection_stats, stalled_clients, routes[], gateways[], active_servers, jetstream, gomemlimit, gomaxprocs`. `DataStats` is `{msgs, bytes}` plus optional `gateways`/`routes`/`leafs` breakdowns. `RouteStat` adds `pending`. — [events.go L367-L431](https://github.com/nats-io/nats-server/blob/v2.15.2/server/events.go#L367-L431)
- natscli `server watch servers` subscribes to `$SYS.SERVER.*.STATSZ` and primes the view with one `$SYS.REQ.SERVER.PING` to a private inbox (unsubscribed after 2 s). Its help text says "updates are sent on a 30 second interval" — [natscli server_watch_srv_command.go L66-L71](https://github.com/nats-io/natscli/blob/v0.5.1/cli/server_watch_srv_command.go#L66-L71), [L101-L126](https://github.com/nats-io/natscli/blob/v0.5.1/cli/server_watch_srv_command.go#L101-L126). This **contradicts** the server source, which uses 10 s ([events.go L101](https://github.com/nats-io/nats-server/blob/v2.15.2/server/events.go#L101)). The CLI help text appears stale.

### Inferences
- **Collector:** every 1 s, publish `$SYS.REQ.SERVER.PING.STATSZ` with a private inbox reply and collect replies for about 500 ms. In parallel, subscribe to `$SYS.SERVER.*.STATSZ` to catch servers that missed the poll. The key is `server.id`. Use `server.time` (the server's clock) for the sample timestamp, and drop samples whose `server.seq` is not newer than the last one stored. Server count is `active_servers`, and an expected server that is missing for 3 s or more is marked down. This needs System credentials (glossary). Without them, fall back to the Monitoring URL `/varz` (out of scope here).
- Cost: N servers × 1 reply/s, each a few KB of JSON, which is negligible. Polling every second does not hit `limitStatsz` because replies go to our inbox.
- **Rates:** `sent.msgs`, `received.bytes` and similar are cumulative counters, so the rate is `(v[t]-v[t-1])/(time[t]-time[t-1])`. On a counter reset (server restart, detectable when `start` changes), emit a gap and not a negative value. `cpu`, `mem` and `connections` are gauges. Cluster totals sum the per-server rates in each second bucket. Bucket = `floor(server.time)` to 1 s so servers align.
- **Ring buffer:** a struct-of-arrays fixed ring per server, using `float32` for gauges and rates (enough precision for charts):

```go
const Slots = 3600 // 1h @ 1s
type Series struct{ v [Slots]float32; t0 int64 } // t0 = unix second of slot 0 epoch
func (s *Series) Put(sec int64, val float32) { s.v[sec%Slots] = val }  // plus NaN-fill skipped slots
func (s *Series) Range(from, to int64) []float32 { /* copy out, NaN for missing */ return nil }

type ServerHistory struct {
    lastSec int64
    prev    ServerStats // for deltas
    CPU, Mem, Conns, MsgsInRate, MsgsOutRate, BytesInRate, BytesOutRate, SlowCons Series
}
```
  Memory: 8 series × 3,600 × 4 B ≈ 115 KB per server. A 10-server cluster is about 1.2 MB, with no allocation per sample and no GC churn. Store the slot's second in a parallel `[Slots]int32`, or NaN-fill on advance, so stale slots from more than an hour ago are never shown.
- Push to the browser via `sendLatest("metrics", frame)` once per second (Q4). Send the full window on subscribe, and after that only the newest point per series.

### Gaps
- The meaning and units of `cpu` (percent of one core vs. all cores) and the `JetStreamVarz` sub-fields were not read in this session. Check `updateServerUsage` in events.go and `JetStreamVarz` in monitor.go.
- No primary source states a supported way to change `statsHBInterval` at runtime or via config. Searching v2.15.2 shows it is only a package `var` (tests modify it).

## 6. KV watch API for live KV views (nats.go `jetstream.KeyValue`)

### Takeaway
`kv.Watch(ctx, keys, opts...)`, `WatchAll` and `WatchFiltered` return a `KeyWatcher` whose `Updates()` channel first delivers the current values (last per key), then **one `nil` sentinel** marking "initial values done", then live updates. **Deletes and purges are included by default**, and `IgnoreDeletes()` suppresses them. Options are `IncludeHistory`, `UpdatesOnly`, `IgnoreDeletes`, `MetaOnly` (headers only, no values) and `ResumeFromRevision`. Internally this is a legacy push ordered consumer, so it is also ephemeral and leaves no trace.

### Cited Findings
- `KeyValue` interface: `Watch(ctx, keys string, …)`, `WatchAll(ctx, …)`, `WatchFiltered(ctx, keys []string, …)`, `ListKeys`, `ListKeysFiltered`. — [jetstream/kv.go L167-L191](https://github.com/nats-io/nats.go/blob/v1.55.0/jetstream/kv.go#L167-L191)
- `KeyWatcher.Updates()`: "…after all initial values have been sent, a nil entry will be sent". — [jetstream/kv.go L346-L352](https://github.com/nats-io/nats.go/blob/v1.55.0/jetstream/kv.go#L346-L352), [L1392-L1394](https://github.com/nats-io/nats.go/blob/v1.55.0/jetstream/kv.go#L1392-L1394)
- Operations `KeyValueDelete` and `KeyValuePurge` are derived from the `KV-Operation` header. An entry is passed unless `ignoreDeletes` is set and the op is a delete or purge. The nil marker is sent when `initDone` first happens (also when there were no pending messages). — [jetstream/kv.go L463-L479](https://github.com/nats-io/nats.go/blob/v1.55.0/jetstream/kv.go#L463-L479), [L1290-L1330](https://github.com/nats-io/nats.go/blob/v1.55.0/jetstream/kv.go#L1290-L1330), [L1372-L1388](https://github.com/nats-io/nats.go/blob/v1.55.0/jetstream/kv.go#L1372-L1388)
- Subscription options: `nats.BindStream(kv.streamName), nats.OrderedConsumer()`. Without `includeHistory` it sets `DeliverLastPerSubject()`. `updatesOnly` sets `DeliverNew()`, `metaOnly` sets `HeadersOnly()`, `resumeFromRevision` sets `StartSequence(rev)`. One key uses `Subscribe(key)`, and several use `ConsumerFilterSubjects(keys...)`. The `Updates()` channel is closed by the subscription's closed handler. — [jetstream/kv.go L1335-L1371](https://github.com/nats-io/nats.go/blob/v1.55.0/jetstream/kv.go#L1335-L1371)
- Option docs: `IncludeHistory` ("include historical values as well (up to KeyValueMaxHistory)"), `UpdatesOnly`, `IgnoreDeletes`, `MetaOnly` ("only the entry metadata, not the entry value"), `ResumeFromRevision`. — [jetstream/kv_options.go L25-L75](https://github.com/nats-io/nats.go/blob/v1.55.0/jetstream/kv_options.go#L25-L75)
- KV `Get` uses the stream `GetMsg` path, so it benefits from Direct Get. KV buckets are created with `allow_direct`, which is the motivating case in ADR-31. — [ADR-31.md L26-L28](https://github.com/nats-io/nats-architecture-and-design/blob/dc0b1c7200f0d716fdee9de1428759594538ed7d/adr/ADR-31.md#L26-L28)

### Inferences
- Live KV view: `WatchAll(ctx, jetstream.MetaOnly())` for the key table (revision, op, created and size come from headers; `Nats-Msg-Size` is again added by headers-only delivery). Fetch values on click with `kv.Get` / `GetRevision`. That mirrors the large-message ADR. For a single-key history panel, use `Watch(ctx, key, jetstream.IncludeHistory())`.
- Keep deletes on (do not pass `IgnoreDeletes`) so the UI can show tombstones and remove rows. A purge means the key's history before it is gone.
- Coalesce per key on the client queue (`sendLatest("kv:"+key, …)`), so a hot key does not flood a slow tab. During the initial load (before `nil`), send batched snapshots. After `nil`, send deltas.
- Stop with `w.Stop()` on view close, using the same ref-count and grace-period approach as Q4. It uses the legacy push ordered consumer, which has heartbeats and flow control (ADR-17), so the server reaps it when interest disappears.

```go
w, err := kv.WatchAll(ctx, jetstream.MetaOnly())
if err != nil { return err }
defer w.Stop()
initial := true
for e := range w.Updates() {
    if e == nil { initial = false; hub.Send(view, readyFrame()); continue }
    row := KVRow{Key: e.Key(), Rev: e.Revision(), Op: e.Operation().String(), Created: e.Created(), Delta: e.Delta()}
    if initial { batch = append(batch, row); continue } // flush batch periodically
    hub.SendLatest(view, "kv:"+e.Key(), encode(row))
}
```

### Gaps
- Not verified: whether `MetaOnly` entries expose size via `Nats-Msg-Size` in `KeyValueEntry` (no accessor was found in the grep). The header may need to be read from the raw message or computed by `Get`.
- The heartbeat and flow-control defaults of the legacy push ordered consumer used by KV watch (in `js.go`) were not read in this session.
