# Browse large streams as metadata first; fetch payloads only on open

Streams can hold millions of messages, and with a raised `max_payload` each one can be several megabytes (10,000 × 4 MB is 40 GB). We never trade away reachability: every message stays reachable by scrolling, filtering or jumping. Instead, the message table holds **metadata only**. The backend lists rows with a short-lived `headers_only` consumer, which delivers headers plus a `Nats-Msg-Size` header and no payload ([consumer.go L108](https://github.com/nats-io/nats-server/blob/v2.15.2/server/consumer.go#L108), [L5774-L5790](https://github.com/nats-io/nats-server/blob/v2.15.2/server/consumer.go#L5774-L5790)). The browser renders only the visible rows of a virtualised table, fetched in pages of 100 with distant pages evicted. A full payload is fetched with a Direct Get ([JSApiMsgGetRequest](https://github.com/nats-io/nats-server/blob/v2.15.2/server/jetstream_api.go#L825-L847)) only when a message is opened, and large payloads are rendered progressively (first 64 KB, then load full or download).

## Considered options

- **Load a fixed window (for example the last 1,000 messages)**: rejected. It hides messages, which is what we set out to avoid.
- **Direct Get batches with `max_bytes` for the table**: rejected as the listing path. It still transfers every payload, so a page of 4 MB messages costs hundreds of megabytes just to show rows. Direct Get stays the way to fetch a single opened message.
- **Paging by row number**: rejected. Sequences have gaps after deletes and purges, so pages are keyed by sequence and the scrollbar position is approximate on very large streams.

## Consequences

- Payload previews in the table exist only for small messages; large ones show their size instead. Previewing the first bytes of a large message would still mean fetching all of it.
- The listing consumer must leave no trace (see **Browsing** in the glossary): ephemeral, never acknowledging, cleaned up when the view closes.
- Very long lists scroll on a scaled scrollbar, because browsers cap element height.
- Messages over 1 MB only exist where an operator raised `max_payload` above the default ([const.go L92-L99](https://github.com/nats-io/nats-server/blob/v2.15.2/server/const.go#L92-L99)), so the UI reads the real limit from the server rather than assuming one.
- The Live tail has the same problem with no way to refetch, because core NATS messages are not stored. The backend keeps full payloads up to a memory budget, then drops the oldest payloads while keeping their rows, marked as no longer held, so the tail never shows fewer messages, only fewer payloads (agreed 2026-10-31).
- WorkQueue and Interest streams are the exception to metadata-only listing (ticket 17, 2026-11-01). A WorkQueue stream refuses the AckNone listing consumer, and acknowledging would remove messages. On an Interest stream a live test (`TestBrowsingConsumerOnInterest`) shows the listing consumer does change retention. While it exists, it holds messages every other consumer has acked and keeps messages nobody else wants, until it reads them. So both list rows with a batched Direct Get capped by a small `max_bytes` (256 KiB, always at least one message). That leaves every message in place but transfers each listed payload, which is the cost this ADR otherwise rejects, and the table says so. Such a stream needs `allow_direct`.
