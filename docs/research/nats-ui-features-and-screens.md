# NATS UI: features, screens, and data sources

- **Date:** 2026-10-30
- **Server version researched:** nats-server **v2.15.2**, the latest release, published 2026-10-26 ([releases](https://github.com/nats-io/nats-server/releases/tag/v2.15.2)). Source links point at the `v2.15.2` tag ([const.go L69](https://github.com/nats-io/nats-server/blob/v2.15.2/server/const.go#L69)).
- **Docs researched:** the live site at docs.nats.io is built from [nats-io/nats.docs.v2](https://github.com/nats-io/nats.docs.v2) (commit `36e49e4`, 2026-10-22). Its reference section is versioned for 2.15, 2.14, 2.12 and 2.11 ([reference_versions.json](https://github.com/nats-io/nats.docs.v2/blob/main/reference_versions.json)). The older [nats-io/nats.docs](https://github.com/nats-io/nats.docs) GitBook repo only goes up to 2.14, and its old URLs now redirect to the new site. Where the two disagree, this document follows the server source.
- **Other sources:** ADRs (nats-architecture-and-design `dc0b1c7`), natscli `e62a4c1` (release 0.5.1), nats.js `812e031` (release v3.4.0), nats-surveyor `029aede`, nats-top `a0c9ca3`.

---

## Executive summary

1. **A UI has two ways to read server state.**
   - **(a) The HTTP monitoring port**, usually `:8222`. It serves `/varz`, `/connz`, `/routez`, `/gatewayz`, `/leafz`, `/subsz`, `/accountz`, `/accstatz`, `/jsz`, `/healthz`, plus `/raftz`, `/ipqueuesz`, `/stacksz` and `/debug/vars` ([server.go L3073-L3087](https://github.com/nats-io/nats-server/blob/v2.15.2/server/server.go#L3073-L3087)).
   - **(b) The same data as NATS request/reply on `$SYS.REQ.SERVER.<id>.<ENDPOINT>` and `$SYS.REQ.SERVER.PING.<ENDPOINT>`**, which requires a system-account user ([events.go L1341-L1361](https://github.com/nats-io/nats-server/blob/v2.15.2/server/events.go#L1341-L1361)).
   - **(b) is the better primary channel.** It is authenticated, it fans out to every server in one request, and it carries write operations too: kick a client, lame-duck a client, reload config.
2. **The HTTP monitoring port has no authentication.** It returns `Access-Control-Allow-Origin: *` ([monitor.go L2632-L2638](https://github.com/nats-io/nats-server/blob/v2.15.2/server/monitor.go#L2632-L2638)), and **JSONP support was removed in v2.15.0** ([commit 548e575](https://github.com/nats-io/nats-server/commit/548e57548b5dd95789b28b615a7990195a03b332)). Treat it as a read-only fallback for servers without a system account. Do not make it the main data path.
3. **All JetStream management happens over NATS request/reply on `$JS.API.*`.** That covers streams, consumers, message get, delete and purge, plus cluster operations such as step-down, peer remove, evacuate and cancel-move ([jetstream_api.go L41-L256](https://github.com/nats-io/nats-server/blob/v2.15.2/server/jetstream_api.go#L41-L256)). Key-Value and Object Store are naming conventions on top of streams (`KV_<bucket>`, `OBJ_<bucket>`), so the same APIs plus the client libraries cover them ([ADR-8](https://github.com/nats-io/nats-architecture-and-design/blob/main/adr/ADR-8.md), [ADR-20](https://github.com/nats-io/nats-architecture-and-design/blob/main/adr/ADR-20.md)).
4. **A browser can only reach NATS over WebSocket.** That needs a `websocket {}` listener configured on the server ([websocket config](https://docs.nats.io/reference/config/websocket/)), and nats.js v3 provides `wsconnect` ([core README](https://github.com/nats-io/nats.js/blob/main/core/README.md)). nats.ws is archived.
5. **Recommended architecture: a thin backend (BFF) with an optional browser-direct mode.**
   - The backend holds credentials, uses plain TCP NATS, can read natscli context files, can safely proxy the unauthenticated monitoring port, and can record time series for charts.
   - A browser-only build works for dev setups where a WebSocket listener and a system user exist.
6. **What can change at runtime and what cannot:**
   - **Runtime, through APIs:** all JetStream assets, KV and Object Store data, connection kick, lame-duck mode, config *reload*, and pushing account JWTs to a `full` resolver.
   - **Needs a config-file edit plus reload or restart:** users, accounts and permissions in static-config mode, listener ports, cluster and gateway topology, and TLS files. A reload re-reads the file on disk and cannot accept new config content ([reload.go L1418-L1432](https://github.com/nats-io/nats-server/blob/v2.15.2/server/reload.go#L1418-L1432)).
7. **MVP screens:** connection manager, overview dashboard, connections, streams (list and detail), consumers, message browser, KV, publish/request tool, live tail, health.
8. **Later screens:** cluster topology, accounts, subjects/subscriptions, object store, events and advisories feed, server config and reload, services (`$SRV`), auth/JWT management, message tracing.
9. **Prior art:** natscli already covers almost every operation and is the best reference implementation. nats-top and Surveyor are monitoring-only, Synadia Control Plane is the commercial full portal, and [NUI](https://github.com/nats-nui/nui) is the closest open-source GUI. A new UI can stand out with live operational views (topology, consumer lag, advisories) combined with data tooling.
10. **Design direction:** a dense, dark-first "ops console" with a command palette, live sparklines fed by `STATSZ`, a collapsible subject tree built from the stream-info `subjects_filter`, and a force-directed or grouped topology graph built from `ROUTEZ`, `GATEWAYZ` and `LEAFZ`.

---

## 1. What a UI can read and control, and through which interface

### 1.1 HTTP monitoring endpoints

**How it works.** You enable the port with `http_port: 8222` or `-m 8222`, and it serves JSON on demand. Nothing is pushed: each `GET` returns a snapshot ([Monitoring endpoints](https://docs.nats.io/learn/monitoring/monitoring-endpoints)).

**Server-side facts that matter for a UI:**

- **No authentication.** The docs say the port is "unauthenticated by default" ([Monitoring endpoints → Pitfalls](https://docs.nats.io/learn/monitoring/monitoring-endpoints)). The v2.15.2 monitor handlers have no auth check (I grepped `monitor.go` and `server.go` for `BasicAuth` and `Authorization`; none found). The reference index advises "Use authentication to protect monitoring endpoints" ([reference/system/monitor](https://docs.nats.io/reference/system/monitor)), but the server has no such feature. In practice that means a reverse proxy or a firewall.
- **CORS.** Every successful response sets `Access-Control-Allow-Origin: *` and `Content-Type: application/json` ([monitor.go L2632-L2638](https://github.com/nats-io/nats-server/blob/v2.15.2/server/monitor.go#L2632-L2638)).
- **400 errors break in the browser.** Bad-parameter responses are written without that header, for example by `decodeBool` ([monitor.go L677-L689](https://github.com/nats-io/nats-server/blob/v2.15.2/server/monitor.go#L677-L689)). A browser will therefore report a 400 as an opaque CORS failure (inferred from the code).
- **JSONP is gone.** It was removed in "[REMOVED] JSONP callback in monitoring endpoints" ([commit 548e575](https://github.com/nats-io/nats-server/commit/548e57548b5dd95789b28b615a7990195a03b332)). That commit is in v2.15.0 and later but not in v2.14.x (checked with the GitHub compare API). The legacy docs still advertise `?callback=` ([legacy nats.docs monitoring](https://github.com/nats-io/nats.docs/blob/master/running-a-nats-service/nats_admin/monitoring/README.md)), and the 2.15 upgrade guide does not mention the removal ([upgrade-to-2.15](https://docs.nats.io/release-notes/upgrade-to-2.15)).
- **HTTPS.** `https_port` serves the endpoints over TLS using the server's main TLS config ([server.go L3144-L3156](https://github.com/nats-io/nats-server/blob/v2.15.2/server/server.go#L3144-L3156)). `http_base_path` prefixes every path ([opts.go L459](https://github.com/nats-io/nats-server/blob/v2.15.2/server/opts.go#L459)). Neither is reloadable ([reference/config/http_port](https://docs.nats.io/reference/config/http_port), [http_base_path](https://docs.nats.io/reference/config/http_base_path)).
- **Mixed content.** A page served over `https://` cannot fetch an `http://` monitoring port, because browsers block mixed content ([MDN: Mixed content](https://developer.mozilla.org/en-US/docs/Web/Security/Mixed_content)).
- **Schemas.** Per-endpoint request and response JSON Schemas for 2.15 are published at [docs.nats.io/reference/system/monitor/*](https://docs.nats.io/reference/system/monitor/varz) (source: `src/schemas/vendor/v2.15/server/monitor/v1/` in nats.docs.v2). Use them to generate TypeScript types.

**Endpoints and the fields a UI needs.** Struct links go to the v2.15.2 source, and parameters come from the reference and legacy docs.

| Endpoint | Key params | Fields worth showing | Source |
|---|---|---|---|
| `/varz` | none | `server_id`, `server_name`, `version`, `uptime`, `start`, `mem`, `cpu`, `cores`, `connections` vs `total_connections`, `subscriptions`, `in_msgs/out_msgs/in_bytes/out_bytes`, `slow_consumers` (+ `slow_consumer_stats`), `stalled_clients`, `routes`, `remotes`, `leafnodes`, `max_payload`, `max_connections`, `cluster`, `gateway`, `leaf`, `websocket`, `jetstream` blocks, `config_load_time`, `config_digest`, `tags`, `system_account`, `tls_cert_not_after` | [Varz struct L1233-L1313](https://github.com/nats-io/nats-server/blob/v2.15.2/server/monitor.go#L1233-L1313) |
| `/connz` | `sort` (cid, start, subs, pending, msgs_to, msgs_from, bytes_to, bytes_from, last, idle, uptime, stop, reason, rtt), `auth`, `subs` / `subs=detail`, `offset`, `limit` (default 1024), `cid`, `state=open\|closed\|any`, `acc`, `user`, `filter_subject`, `mqtt_client` | per connection: `cid`, `kind`, `type`, `ip`, `port`, `name`, `lang`, `version`, `account`, `authorized_user`, `rtt`, `uptime`, `idle`, `last_activity`, `pending_bytes`, `in/out_msgs/bytes`, `subscriptions`, `subscriptions_list`, `tls_version`, `reason` (closed) | [Connz/ConnInfo L49-L157](https://github.com/nats-io/nats-server/blob/v2.15.2/server/monitor.go#L49-L157), [DefaultConnListSize L170](https://github.com/nats-io/nats-server/blob/v2.15.2/server/monitor.go#L170), [legacy param table](https://github.com/nats-io/nats.docs/blob/master/running-a-nats-service/nats_admin/monitoring/README.md#connection-information-connz) |
| `/routez` | `subs` | `num_routes`, per route `remote_id`, `remote_name`, `did_solicit`, `is_configured`, `ip`, `rtt`, `pending_size`, `in/out_*`, `compression`, `account` (pinned) | [Routez L813-L860](https://github.com/nats-io/nats-server/blob/v2.15.2/server/monitor.go#L813-L860) |
| `/gatewayz` | `accs`, `gw_name`, `acc_name` | `name`, `outbound_gateways`, `inbound_gateways` (map by gateway name → connection info), per-account `interest_mode`, `no_interest_count` | [Gatewayz L2107-L2135](https://github.com/nats-io/nats-server/blob/v2.15.2/server/monitor.go#L2107-L2135) |
| `/leafz` | `subs`, `acc` | `leafnodes`, per leaf `name`, `is_spoke`, `is_isolated`, `account`, `ip`, `rtt`, `in/out_*`, `subscriptions`, `compression`, `websocket` | [Leafz/LeafInfo L2431-L2475](https://github.com/nats-io/nats-server/blob/v2.15.2/server/monitor.go#L2431-L2475) |
| `/subsz` | `subs`, `offset`, `limit`, `test=<subject>`, `acc` | totals, plus per-sub `subject`, `qgroup`, `sid`, `msgs`, `cid`, `account` | [Subsz/SubDetail L959-L1000](https://github.com/nats-io/nats-server/blob/v2.15.2/server/monitor.go#L959-L1000) |
| `/accountz` | `acc` | list of account names, or for one account: `jetstream_enabled`, `client_connections`, `leafnode_connections`, `subscriptions`, `imports`, `exports`, `mappings`, `jwt` / `decoded_jwt`, `revoked_user`, `expired`, `is_system` | [AccountInfo/Accountz L2760-L2795](https://github.com/nats-io/nats-server/blob/v2.15.2/server/monitor.go#L2760-L2795) |
| `/accstatz` | `unused`, `accs` | per account `conns`, `leafnodes`, `total_conns`, `num_subscriptions`, `sent`, `received`, `slow_consumers` | [AccountStatz L2555](https://github.com/nats-io/nats-server/blob/v2.15.2/server/monitor.go#L2555-L2559), [AccountStat events.go L217](https://github.com/nats-io/nats-server/blob/v2.15.2/server/events.go#L217) |
| `/jsz` | `acc`, `accounts`, `streams`, `consumers`, `config`, `leader-only`, `offset`, `limit`, `raft` | `memory`, `storage`, `reserved_*`, `api` (totals and errors), `streams`, `consumers`, `messages`, `bytes`, `meta_cluster` (`leader`, `replicas`, `cluster_size`, `quorum_needed`, `pending`, `rescue`), `account_details[].stream_detail[]` | [JSInfo L3127-L3143](https://github.com/nats-io/nats-server/blob/v2.15.2/server/monitor.go#L3127-L3143), [MetaClusterInfo L3112](https://github.com/nats-io/nats-server/blob/v2.15.2/server/monitor.go#L3112-L3124), [JetStreamStats](https://github.com/nats-io/nats-server/blob/v2.15.2/server/jetstream.go#L61) |
| `/healthz` | `js-enabled-only`, `js-server-only`, `js-meta-only`, `account`, `stream`, `consumer`, `details` | `status`, `error`, `errors[]` (`type`, `account`, `stream`, `consumer`). HTTP 200 when healthy and **503** when not | [HealthzOptions L3018-L3028](https://github.com/nats-io/nats-server/blob/v2.15.2/server/monitor.go#L3018-L3028), [HealthStatus L3507-L3520](https://github.com/nats-io/nats-server/blob/v2.15.2/server/monitor.go#L3507-L3520), [docs](https://docs.nats.io/learn/monitoring/monitoring-endpoints) |
| `/raftz`, `/ipqueuesz`, `/stacksz` | `acc`, `group` / `all`, `filter` | RAFT group state, internal queues, goroutine dump (diagnostics) | [server.go L3193-L3205](https://github.com/nats-io/nats-server/blob/v2.15.2/server/server.go#L3193-L3205) |

**Practical cautions:**

- An unscoped `/jsz?accounts=true&streams=true&consumers=true` walks every asset and can time out at scale. Scope it with `acc=` and paginate ([Monitoring endpoints → Pitfalls](https://docs.nats.io/learn/monitoring/monitoring-endpoints)).
- Alert on `connections`, not `total_connections` (same page).
- Closed connections are kept in a ring buffer of 10,000 by default (`max_closed_clients`) ([const.go L192](https://github.com/nats-io/nats-server/blob/v2.15.2/server/const.go#L192)). A "closed connections" view is therefore bounded.

### 1.2 The `$SYS` system account: requests and events

**Requirements.** System events and services need a system account. The default system account name is `$SYS` ([const.go L244](https://github.com/nats-io/nats-server/blob/v2.15.2/server/const.go#L244)), and you have to connect as a user in that account ([Advisories & events](https://docs.nats.io/learn/monitoring/advisories-and-events)).

**Request subjects** ([events.go L43-L96](https://github.com/nats-io/nats-server/blob/v2.15.2/server/events.go#L43-L96)):

| Subject | Purpose | Notes |
|---|---|---|
| `$SYS.REQ.SERVER.PING.<EP>` | Fan out to **all** servers | `EP` ∈ `STATSZ, VARZ, SUBSZ, CONNZ, ROUTEZ, GATEWAYZ, LEAFZ, ACCOUNTZ, JSZ, HEALTHZ, IDZ, PROFILEZ, EXPVARZ, IPQUEUESZ, RAFTZ` ([L1276-L1326](https://github.com/nats-io/nats-server/blob/v2.15.2/server/events.go#L1276-L1326)). Multiple replies, so use a request-many pattern with a stall timer ([ADR-47](https://github.com/nats-io/nats-architecture-and-design/blob/main/adr/ADR-47.md)). nats.js has `requestMany` ([core.ts L520](https://github.com/nats-io/nats.js/blob/main/core/src/core.ts#L520)). `$SYS.REQ.SERVER.PING` alone is the legacy form of STATSZ ([L69](https://github.com/nats-io/nats-server/blob/v2.15.2/server/events.go#L69)) |
| `$SYS.REQ.SERVER.<id>.<EP>` | One specific server | Same endpoint set ([L1352](https://github.com/nats-io/nats-server/blob/v2.15.2/server/events.go#L1352)). The request body carries the same options as the HTTP query params |
| `$SYS.REQ.ACCOUNT.<acc>.<EP>` | Per-account view from all servers | `SUBSZ, CONNZ, LEAFZ, JSZ, INFO, STATZ, CONNS` ([L1370-L1447](https://github.com/nats-io/nats-server/blob/v2.15.2/server/events.go#L1370-L1447)). `$SYS.REQ.ACCOUNT.PING.STATZ` is the bus equivalent of `/accstatz` ([L1464](https://github.com/nats-io/nats-server/blob/v2.15.2/server/events.go#L1464)) |
| `$SYS.REQ.SERVER.<id>.RELOAD` | **Write:** reload config from disk | Since 2.10 ([config docs, legacy](https://github.com/nats-io/nats.docs/blob/master/running-a-nats-service/configuration/README.md#configuration-reloading)). Handler calls `s.Reload()` ([L3221-L3231](https://github.com/nats-io/nats-server/blob/v2.15.2/server/events.go#L3221-L3231)) |
| `$SYS.REQ.SERVER.<id>.KICK` | **Write:** disconnect client `{"cid":N}` | [L3233-L3257](https://github.com/nats-io/nats-server/blob/v2.15.2/server/events.go#L3233-L3257). natscli `server request kick` uses it ([server_request_command.go L300](https://github.com/nats-io/natscli/blob/main/cli/server_request_command.go#L300)) |
| `$SYS.REQ.SERVER.<id>.LDM` | **Write:** send lame-duck to one client `{"cid":N}` | [L3237-L3275](https://github.com/nats-io/nats-server/blob/v2.15.2/server/events.go#L3237-L3275) |
| `$SYS.REQ.CLAIMS.UPDATE` / `.LIST` / `.DELETE` / `.PACK`, `$SYS.REQ.ACCOUNT.<id>.CLAIMS.LOOKUP` | **Write:** account JWT management on the NATS resolver | [L43-L47](https://github.com/nats-io/nats-server/blob/v2.15.2/server/events.go#L43-L47), [legacy resolver docs](https://github.com/nats-io/nats.docs/blob/master/running-a-nats-service/configuration/securing_nats/jwt/resolver.md) |
| `$SYS.REQ.USER.INFO` | "Who am I": the caller's user, account and permissions | [L76](https://github.com/nats-io/nats-server/blob/v2.15.2/server/events.go#L76) |

**Pushed events**, for live feeds ([events.go L49-L96](https://github.com/nats-io/nats-server/blob/v2.15.2/server/events.go#L49-L96); [Advisories & events](https://docs.nats.io/learn/monitoring/advisories-and-events)):

- `$SYS.ACCOUNT.<acc>.CONNECT` and `$SYS.ACCOUNT.<acc>.DISCONNECT`: connect and disconnect events. The disconnect body includes `sent`, `received` and `reason` ([ConnectEventMsg/DisconnectEventMsg](https://github.com/nats-io/nats-server/blob/v2.15.2/server/events.go)). Schemas: [client-connect](https://docs.nats.io/reference/system/advisory/client-connect).
- `$SYS.ACCOUNT.<acc>.SERVER.CONNS`: account connection-count changes.
- `$SYS.SERVER.<id>.STATSZ`: a heartbeat every **10 s** in steady state, ramping up from 250 ms after startup ([statsHBInterval L101](https://github.com/nats-io/nats-server/blob/v2.15.2/server/events.go#L101), [L1150](https://github.com/nats-io/nats-server/blob/v2.15.2/server/events.go#L1150)). It carries `mem`, `cpu`, `connections`, `active_accounts`, `subscriptions`, `sent`, `received`, `slow_consumers`, `routes`, `gateways`, `jetstream` ([ServerStats L367](https://github.com/nats-io/nats-server/blob/v2.15.2/server/events.go#L367)). **This is the cheapest feed for live dashboard charts:** a UI just subscribes to `$SYS.SERVER.*.STATSZ`.
- `$SYS.SERVER.<id>.SHUTDOWN`, `$SYS.SERVER.<id>.LAMEDUCK`, `$SYS.SERVER.<id>.CLIENT.AUTH.ERR`, `$SYS.ACCOUNT.CLIENT.AUTH.ERR`, and OCSP peer reject events.

**JetStream advisories.** These are published under `$JS.EVENT.ADVISORY.>`, covering stream and consumer create/update/delete, leader elected, quorum lost, `MAX_DELIVERIES`, `MSG_NAKED`, `MSG_TERMINATED`, pause, pinned/unpinned, and snapshot/restore ([jetstream_api.go L272-L340](https://github.com/nats-io/nats-server/blob/v2.15.2/server/jetstream_api.go#L272-L340); schemas under [reference/jetstream/advisory](https://docs.nats.io/reference/jetstream/advisory)). They are **transient**: a UI only sees events while it is subscribed. To show history, capture them into a stream ([Advisories & events → Pitfalls](https://docs.nats.io/learn/monitoring/advisories-and-events)).

### 1.3 JetStream API (`$JS.API.*`)

**How it works.** All calls are JSON request/reply ([ADR-1](https://github.com/nats-io/nats-architecture-and-design/blob/main/adr/ADR-1.md), [JetStream API reference](https://docs.nats.io/reference/jetstream/api/)). The domain-prefixed form `$JS.<domain>.API.>` targets a specific JetStream domain, for example a leaf node ([jetstream_api.go L41-L46](https://github.com/nats-io/nats-server/blob/v2.15.2/server/jetstream_api.go#L41-L46)). Subjects ([jetstream_api.go L50-L256](https://github.com/nats-io/nats-server/blob/v2.15.2/server/jetstream_api.go#L50-L256)):

| Area | Subjects | UI use |
|---|---|---|
| Account | `$JS.API.INFO` | Per-account usage and limits. Works for **non-system** users, so it suits a tenant dashboard |
| Streams | `STREAM.CREATE.<s>`, `UPDATE.<s>`, `DELETE.<s>`, `INFO.<s>`, `NAMES`, `LIST`, `PURGE.<s>`, `SNAPSHOT.<s>`, `RESTORE.<s>` | CRUD, list, detail, backup/restore |
| Messages | `STREAM.MSG.GET.<s>`, `STREAM.MSG.DELETE.<s>`, `DIRECT.GET.<s>`, `DIRECT.GET.<s>.<subject>` | Message browser |
| Consumers | `CONSUMER.CREATE.<s>[.<c>.<filter>]`, `DURABLE.CREATE.<s>.<c>`, `NAMES.<s>`, `LIST.<s>`, `INFO.<s>.<c>`, `DELETE.<s>.<c>`, `PAUSE.<s>.<c>`, `UNPIN.<s>.<c>`, `RESET.<s>.<c>` | Consumer list, detail, pause/resume |
| Cluster ops | `STREAM.LEADER.STEPDOWN.<s>`, `CONSUMER.LEADER.STEPDOWN.<s>.<c>`, `STREAM.PEER.REMOVE.<s>`, `STREAM.PEER.EVACUATE.<s>`, `STREAM.CANCEL_MOVE.<s>` | Replica management (evacuate and cancel-move are new in 2.15 ([v2.15.0 notes](https://github.com/nats-io/nats-server/releases/tag/v2.15.0), [ADR-62](https://github.com/nats-io/nats-architecture-and-design/blob/main/adr/ADR-62.md))) |
| System-only | `META.LEADER.STEPDOWN`, `SERVER.REMOVE`, `SERVER.EVACUATE`, `META.RESCUE`, `ACCOUNT.PURGE.<a>`, `ACCOUNT.STREAM.MOVE.*.*`, `ACCOUNT.STREAM.CANCEL_MOVE.*.*` | Marked "Only works from system account" ([L212-L253](https://github.com/nats-io/nats-server/blob/v2.15.2/server/jetstream_api.go#L212-L253)). Gate these behind a confirm step plus an admin role |

**Request details a UI needs:**

- **Paging.** List and names responses are paged (`total`, `offset`, `limit`) ([ApiPaged L458](https://github.com/nats-io/nats-server/blob/v2.15.2/server/jetstream_api.go#L458-L462)). The caps are 1024 for names and 256 for lists ([L511-L514](https://github.com/nats-io/nats-server/blob/v2.15.2/server/jetstream_api.go#L511-L514)). `NAMES` and `LIST` accept a `subject` filter.
- **Stream info.** It accepts `subjects_filter` (for example `>`) and returns a `subjects` map of subject → message count, up to 100,000 entries per page ([L495-L501](https://github.com/nats-io/nats-server/blob/v2.15.2/server/jetstream_api.go#L495-L501)). **This is what feeds a subject tree.** `deleted_details` returns interior deletes. State fields: `messages`, `bytes`, `first_seq`, `first_ts`, `last_seq`, `last_ts`, `num_subjects`, `num_deleted`, `consumer_count` ([store.go L172](https://github.com/nats-io/nats-server/blob/v2.15.2/server/store.go#L172)). Info also has `cluster` (leader and replicas with `current`, `active`, `lag`, `offline`), `mirror`, `sources` and `alternates` ([StreamInfo L345](https://github.com/nats-io/nats-server/blob/v2.15.2/server/stream.go#L345), [PeerInfo L462](https://github.com/nats-io/nats-server/blob/v2.15.2/server/stream.go#L462)).
- **Message get.** It accepts `seq`, `last_by_subj`, `next_by_subj`, `start_time`, `batch`, `max_bytes`, `multi_last`, `up_to_seq`, `up_to_time`, `no_hdr` ([L825](https://github.com/nats-io/nats-server/blob/v2.15.2/server/jetstream_api.go#L825)). Batch and multi-last forms apply to Direct Get ([ADR-31](https://github.com/nats-io/nats-architecture-and-design/blob/main/adr/ADR-31.md)). Direct Get needs `allow_direct` on the stream and can be served by any replica ([Get Direct](https://docs.nats.io/learn/jetstream/get-direct)).
- **Purge.** It accepts `filter` (by subject), `seq` (up to) and `keep` (retain the last N) ([L555](https://github.com/nats-io/nats-server/blob/v2.15.2/server/jetstream_api.go#L555); [ADR-10](https://github.com/nats-io/nats-architecture-and-design/blob/main/adr/ADR-10.md)). A UI can offer "purge subject X, keep last 10".
- **Message delete.** It accepts `seq` and `no_erase` ([L599](https://github.com/nats-io/nats-server/blob/v2.15.2/server/jetstream_api.go#L599)).
- **Consumer info.** It includes `delivered`, `ack_floor`, `num_ack_pending`, `num_redelivered`, `num_waiting`, `num_pending` (lag), `paused`, `pause_remaining`, `priority_groups`, `cluster` ([ConsumerInfo L56](https://github.com/nats-io/nats-server/blob/v2.15.2/server/consumer.go#L56)).
- **Browsing without side effects.** Use an **ordered consumer** (ephemeral, flow-controlled, no acks) with a deliver policy set to a start sequence or time ([ADR-17](https://github.com/nats-io/nats-architecture-and-design/blob/main/adr/ADR-17.md)). nats.js supports it ([jetstream README](https://github.com/nats-io/nats.js/blob/main/jetstream/README.md)). This never disturbs application consumers.
- **New default in 2.15: 1000 consumers per stream.** This matters for a UI that creates ephemeral browse consumers ([v2.15.0 notes](https://github.com/nats-io/nats-server/releases/tag/v2.15.0)). Prefer Direct Get or MSG.GET for single-message reads.
- **Client library.** nats.js `jetstreamManager()` wraps these calls: `streams.list/info/add/update/getMessage/deleteMessage/purge` and the consumer equivalents ([jetstream README L119-L160](https://github.com/nats-io/nats.js/blob/main/jetstream/README.md#jetstreammanager-jsm)).

### 1.4 Key-Value and Object Store

**Key-Value** ([ADR-8](https://github.com/nats-io/nats-architecture-and-design/blob/main/adr/ADR-8.md); [Key/Value docs](https://docs.nats.io/learn/key-value/)):

- **Storage layout.** A bucket is a stream named `KV_<bucket>` with subjects `$KV.<bucket>.>`, and history depth equals `max_msgs_per_subject` ([ADR-8 L238-L240](https://github.com/nats-io/nats-architecture-and-design/blob/main/adr/ADR-8.md)).
- **Reads and deletes.** A get is a message get with `last_by_subj`. A delete is a marker message with `KV-Operation: DEL`. A purge uses `KV-Operation: PURGE` plus `Nats-Rollup: sub` (ADR-8 L336-L398).
- **Bucket listing.** List buckets by listing stream names with the `KV_` prefix.
- **What a UI needs:** a key list, a value view with revision and operation, a history timeline, a live watch (with options such as include-history, updates-only and headers-only; ADR-8 L424-L429), put/delete/purge, and bucket config (TTL ([ADR-48](https://github.com/nats-io/nats-architecture-and-design/blob/main/adr/ADR-48.md)), history, replicas).
- **Client library:** nats.js `@nats-io/kv` provides `create`, `watch`, `history` and `keys` ([kv README](https://github.com/nats-io/nats.js/blob/main/kv/README.md)).

**Object Store** ([ADR-20](https://github.com/nats-io/nats-architecture-and-design/blob/main/adr/ADR-20.md); [Object Store docs](https://docs.nats.io/learn/object-store/)):

- **Storage layout.** The stream is `OBJ_<bucket>`. Chunks live at `$O.<bucket>.C.<nuid>` and metadata at `$O.<bucket>.M.<base64url(name)>` ([ADR-20 L114-L118](https://github.com/nats-io/nats-architecture-and-design/blob/main/adr/ADR-20.md); [under the hood](https://docs.nats.io/learn/object-store/under-the-hood)).
- **Object info fields:** `name`, `size`, `chunks`, `digest` (`SHA-256=`), `mtime`, `description`, `headers`, `metadata`, and links (ADR-20 L160-L240).
- **What a UI needs:** upload and download (streamed, chunked), list, watch, delete, seal, and link.
- **Client library:** nats.js `@nats-io/obj` ([obj README](https://github.com/nats-io/nats.js/blob/main/obj/README.md)).

### 1.5 Core pub/sub and request/reply

- **Publish tool.** Publish takes a subject, an optional reply subject, headers and a payload ([Publish-subscribe](https://docs.nats.io/concepts/pub-sub-basics), [Headers](https://docs.nats.io/learn/core-nats/headers)).
- **Request tool.** A request with no responders returns a status-503 reply immediately ([Request-reply](https://docs.nats.io/learn/core-nats/request-reply)). Show it as a distinct "no responders" result, not a timeout. Use request-many for scatter-gather ([ADR-47](https://github.com/nats-io/nats-architecture-and-design/blob/main/adr/ADR-47.md)).
- **Live tail.** Subscribe with `*` and `>` wildcards ([Subjects & wildcards](https://docs.nats.io/concepts/subjects)).
  - **Slow-consumer risk.** The server disconnects slow consumers ([Slow consumers](https://docs.nats.io/learn/resilient-clients/slow-consumers)), and a UI subscribed to `>` on a busy system will be one. Required safeguards: client-side sampling, rate display, a max-buffer ring, and pause/resume.
- **Message tracing** (later phase). Publish with the `Nats-Trace-Dest` header, and optionally `Nats-Trace-Only` to skip delivery. Servers then report each hop to the trace subject ([ADR-41](https://github.com/nats-io/nats-architecture-and-design/blob/main/adr/ADR-41.md), [msgtrace.go L29](https://github.com/nats-io/nats-server/blob/v2.15.2/server/msgtrace.go#L29)). natscli implements this as `nats trace` ([trace_command.go](https://github.com/nats-io/natscli/blob/main/cli/trace_command.go)).
- **Services.** Services built on the Service API answer `$SRV.PING|INFO|STATS[.<name>[.<id>]]` ([ADR-32](https://github.com/nats-io/nats-architecture-and-design/blob/main/adr/ADR-32.md)). That gives a free "Services" discovery screen.

### 1.6 Auth and security: what can change at runtime and what cannot

**Auth modes** ([Security docs](https://docs.nats.io/learn/security/authentication-basics)):

- **Static config:** tokens, user/password, NKeys, TLS client certs, and `accounts {}` blocks.
- **Operator / JWT mode:** a trust chain of operator → account → user JWTs, resolved through an account resolver ([Operator mode](https://docs.nats.io/learn/security/operator-mode), [Decentralized auth](https://docs.nats.io/learn/security/decentralized-auth)).
- **Auth callout:** an external service decides each connection ([Auth callout](https://docs.nats.io/learn/security/auth-callout), [ADR-26](https://github.com/nats-io/nats-architecture-and-design/blob/main/adr/ADR-26.md)).

| Change | Runtime via API? | How |
|---|---|---|
| Read who is connected, as which user and account | Yes | `/connz?auth=true` or `CONNZ`. `$SYS.REQ.USER.INFO` for self |
| Disconnect one client | Yes | `$SYS.REQ.SERVER.<id>.KICK` (system account) |
| Create or update an **account** in operator mode | Yes, if you hold the operator or account signing keys and use a `full` resolver | Sign the account JWT, then request `$SYS.REQ.CLAIMS.UPDATE`. Each `full` resolver replies with success or failure ([legacy resolver docs](https://github.com/nats-io/nats.docs/blob/master/running-a-nats-service/configuration/securing_nats/jwt/resolver.md)). `nats auth account push` does this ([Decentralized auth](https://docs.nats.io/learn/security/decentralized-auth)) |
| Create a **user** in operator mode | No server call needed | Users are JWTs signed by the account key and never stored on the server ("the server never consults your store") ([Decentralized auth](https://docs.nats.io/learn/security/decentralized-auth)). The UI needs local key material, which is the job of nsc or `nats auth` |
| Revoke a user (operator mode) | Yes, through an account JWT push | Revocations live in the account JWT, and the push disconnects revoked users ([Decentralized auth → Revoking](https://docs.nats.io/learn/security/decentralized-auth)) |
| Add, edit or remove users, accounts or permissions in **static config** | **No.** Edit the file, then reload | `authorization`, `accounts`, `users`, `nkeys` are reloadable ([reload.go diffOptions L1605+](https://github.com/nats-io/nats-server/blob/v2.15.2/server/reload.go#L1605); [Config management](https://docs.nats.io/learn/deployment/config-management)). The reload is triggered by SIGHUP or `$SYS.REQ.SERVER.<id>.RELOAD`, and it **re-reads the file**. A server started without `-c` cannot reload ([reload.go L1418-L1432](https://github.com/nats-io/nats-server/blob/v2.15.2/server/reload.go#L1418-L1432)) |
| TLS certificates | File change, then reload | The TLS block is reloadable and the server re-reads the cert files ([reference/config/tls](https://docs.nats.io/reference/config/tls), [Config management](https://docs.nats.io/learn/deployment/config-management)). `tls_cert_not_after` in `/varz` lets a UI warn about expiry ([Varz](https://github.com/nats-io/nats-server/blob/v2.15.2/server/monitor.go#L1233-L1313)) |
| Ports, listen hosts, `server_name`, `http_port`, `operator`, `trusted_keys`, `system_account`, `max_subscriptions` | **Restart** | Marked not-reloadable in [reference/config](https://docs.nats.io/reference/config/) and rejected by `diffOptions` ([reload.go L2005-L2016](https://github.com/nats-io/nats-server/blob/v2.15.2/server/reload.go#L2005-L2016)) |
| JetStream `store_dir` while JetStream is running | **Restart** | Source: "config reload not supported for jetstream storage directory" ([reload.go L1842](https://github.com/nats-io/nats-server/blob/v2.15.2/server/reload.go#L1842)). The reference page marks it "reloadable" only while JetStream is not yet enabled ([reference/config/store_dir](https://docs.nats.io/reference/config/store_dir)), which is consistent with the source |

**Implication for the UI.** Show a "config reload" action plus `config_load_time` and `config_digest` from `/varz`, but not a config editor. The exception is the backend running on the same host as the server with file access, which is out of scope for the MVP. The config file itself cannot be read over any API: `/varz` exposes effective values, not the file.

### 1.7 Clustering, superclusters (gateways) and leaf nodes

**Concepts:**

- **Clusters.** A cluster is a full mesh of servers joined by routes ([Clustering](https://docs.nats.io/learn/clustering/)). Since 2.10 routes are pooled, so `/routez` shows several entries per peer and the UI should group by `remote_name` ([Monitoring endpoints](https://docs.nats.io/learn/monitoring/monitoring-endpoints)).
- **Gateways.** A gateway joins *clusters* into a supercluster ([Super-clusters](https://docs.nats.io/learn/topologies/super-clusters)).
- **Leaf nodes.** A leaf node dials out to a hub and carries only the subjects with interest. A leaf with its own JetStream needs a distinct domain ([Leaf nodes](https://docs.nats.io/learn/topologies/leaf-nodes)).

**Topology inputs:**

- `$SYS.REQ.SERVER.PING.VARZ` gives each server's `cluster.name`, `gateway.name` and `leaf` config.
- `ROUTEZ` gives the edges inside a cluster.
- `GATEWAYZ` gives cluster-to-cluster edges, with `outbound_gateways` and `inbound_gateways`.
- `LEAFZ` gives the leaf edges, with `is_spoke`, `account` and `rtt`.
- `JSZ` (`meta_cluster`) gives the JetStream meta leader, peers, `quorum_needed` and pending entries.
- `/raftz` gives per-RAFT-group detail.

**Controls.** Meta and stream/consumer leader step-down, peer remove, and server evacuate, all from §1.3. 2.15 adds safe evacuate and cancel-move ([ADR-62](https://github.com/nats-io/nats-architecture-and-design/blob/main/adr/ADR-62.md)) and an unsafe `META.RESCUE` for disaster recovery ([ADR-61](https://github.com/nats-io/nats-architecture-and-design/blob/main/adr/ADR-61.md)). `META.RESCUE` should never be a one-click action.

### 1.8 Browser connectivity and the browser-only vs backend-proxy trade-off

**WebSocket listener** ([reference/config/websocket](https://docs.nats.io/reference/config/websocket/), [Browsers and origins](https://docs.nats.io/learn/websocket/browsers-and-origins)):

- **Not on by default.** You have to add a `websocket {}` block. TLS is required unless you set `no_tls: true`.
- **Binary frames only** ([legacy WebSocket docs](https://github.com/nats-io/nats.docs/blob/master/running-a-nats-service/configuration/websocket/README.md)).
- **Origin checks.** `allowed_origins` matches scheme, host and port exactly, and `same_origin` requires the Origin to match the request host. With neither set, any origin is accepted. The check runs only when an `Origin` header is present, so it does not replace permissions.
- **Browser credentials.** A browser has no credentials file. The options are a bearer user JWT, or `jwt_cookie` (operator mode only) set as an HttpOnly cookie by your auth server. Never put seeds in front-end code (same page).
- **Client library.** nats.js v3 replaced nats.ws: the browser transport is `wsconnect` in `@nats-io/nats-core`, which assumes `wss://` ([nats.js README](https://github.com/nats-io/nats.js/blob/main/README.md), [core README](https://github.com/nats-io/nats.js/blob/main/core/README.md)). The nats.ws repo is archived (GitHub API `archived=true`). The JetStream, KV, Obj and Services modules all work over a `wsconnect` connection.

**Trade-off:**

| Concern | Browser-only (nats.js `wsconnect`) | Backend proxy / BFF (nats.go or nats.js node transport) |
|---|---|---|
| Server prerequisites | WebSocket listener must be configured, plus TLS for `wss://` | None beyond normal client port 4222 |
| Monitoring HTTP port | CORS `*` works for successful GETs, but errors are opaque, JSONP is gone, HTTPS pages hit mixed-content blocks, and the port is unauthenticated, so exposing it to browsers is risky | Proxies `:8222` server-side, adds auth, and normalises errors |
| Credentials | Must be typed in or held in browser storage. Creds and NKey files must be pasted, and cannot be read from disk | Keeps creds and seeds server-side, and can read natscli contexts from `~/.config/nats/context/*.json` ([ADR-21](https://github.com/nats-io/nats-architecture-and-design/blob/main/adr/ADR-21.md)) |
| Multi-cluster and many connections | One WebSocket per server or cluster from the tab | Connection pooling, shared across users |
| History and charts | Only while the tab is open | Can persist STATSZ and advisories for history and alerting (Surveyor-like) |
| Deployment | Static files | One extra service, or a desktop wrapper (Tauri or Electron) that gives TCP and filesystem access |
| Security review | Every user's browser talks to NATS directly, so per-user NATS permissions are needed | One audited service. Map UI users to NATS roles |

**Recommendation.** Build the data layer against an abstract "NATS connection" interface so the same UI runs in both modes. Ship BFF mode as the default, and browser-direct mode for local dev and for users who already run a WebSocket listener. Fetch monitoring data primarily via `$SYS.REQ.*`. Fall back to the HTTP port only when no system user is available.

---

## 2. Recommended feature set

### MVP (phase 1): "see it and poke it"

Everything here is supported by stable APIs today.

1. **Connection profiles.** URL list, auth type (none, user/pass, token, NKey, creds, JWT), TLS, JetStream domain or API prefix, and inbox prefix. These mirror the natscli context fields ([ADR-21](https://github.com/nats-io/nats-architecture-and-design/blob/main/adr/ADR-21.md)). In BFF mode, import contexts from natscli. Detect capabilities on connect: is this a system user (`$SYS.REQ.USER.INFO`), is JetStream available (`$JS.API.INFO`), and is the monitoring URL reachable.
2. **Overview dashboard.** Server count and versions, connections, msgs/bytes in and out per second, slow consumers, memory and CPU, and JetStream usage against limits. Data comes from the `STATSZ` subscription or from polling `/varz` and `/jsz`.
3. **Connections table.** Sortable and filterable by account, user, name and subject, with an RTT and pending-bytes highlight, a closed-connections tab with reasons, and a **Kick** action for system users. Data: `CONNZ` / `/connz`, plus `KICK`.
4. **Streams.** List, detail (config, state, cluster replicas and lag, sources/mirror), and create/edit forms driven by the stream-config schema. Delete and purge (by subject, keep N, up to seq). Data: `$JS.API.STREAM.*`.
5. **Consumers.** Per-stream list with pending, ack-pending, redelivered and waiting counts, plus detail, delete and pause/resume. Data: `$JS.API.CONSUMER.*`.
6. **Message browser.** Jump to a sequence, time or subject, page forward and backward, view headers and payload (JSON, text or hex), delete a message, and copy as a `nats` CLI command. Data: `DIRECT.GET`, `MSG.GET` and ordered consumers.
7. **KV.** Bucket list, keys, value plus history, live watch, and put/delete/purge. Data: `@nats-io/kv` / ADR-8.
8. **Publish / request.** Subject, headers, payload editor, reply-subject display, no-responders handling, and saved requests.
9. **Live tail.** Wildcard subscribe with pause, sampling, a rate meter and a bounded buffer.
10. **Health.** `HEALTHZ` from all servers, with the per-asset error list. Data: `$SYS.REQ.SERVER.PING.HEALTHZ` or `/healthz?details=true`.

### Phase 2: "operate it"

- **Cluster topology graph:** routes, gateways, leaf nodes and the JetStream meta leader, with step-down, peer-remove and evacuate actions behind confirmations.
- **Events and advisories feed:** `$SYS.ACCOUNT.*.CONNECT/DISCONNECT`, auth errors, lame-duck and shutdown, and `$JS.EVENT.ADVISORY.>`. Optionally offer to create a capture stream so history survives.
- **Accounts:** an `ACCOUNTZ` / `ACCSTATZ` view of connections, subscriptions, imports/exports, mappings, JetStream on/off and decoded JWT.
- **Subjects / subscriptions explorer:** `SUBSZ` with `test=<subject>` for "who would receive this?", plus the stream subject tree.
- **Object Store browser** with upload and download.
- **Server info and config:** effective `/varz` config, TLS expiry, `config_load_time` and `config_digest`, plus a **Reload** button (`RELOAD`) and per-client lame-duck (`LDM`).
- **Services screen:** `$SRV.PING/INFO/STATS` ([ADR-32](https://github.com/nats-io/nats-architecture-and-design/blob/main/adr/ADR-32.md)).
- **Persisted metrics history and threshold alerts** (BFF only). natscli `server check` is the model for check semantics ([server_check_command.go](https://github.com/nats-io/natscli/blob/main/cli/server_check_command.go)).

### Phase 3: "own it"

- **Operator-mode auth management:** create and edit accounts, generate users and creds, revocations, and push via `$SYS.REQ.CLAIMS.UPDATE`. This needs secure key storage, which is a large security scope. Study `nats auth` ([auth_command.go](https://github.com/nats-io/natscli/blob/main/cli/auth_command.go)) and nsc first.
- **Message path tracing** UI ([ADR-41](https://github.com/nats-io/nats-architecture-and-design/blob/main/adr/ADR-41.md)).
- **Stream backup and restore** (snapshot/restore API, with the v2 format in 2.15 ([ADR-63](https://github.com/nats-io/nats-architecture-and-design/blob/main/adr/ADR-63.md))).
- **Placement and moves:** stream move and cancel-move across clusters, plus the desired-state view ([ADR-62](https://github.com/nats-io/nats-architecture-and-design/blob/main/adr/ADR-62.md)).
- **Payload decoders** (Protobuf or CBOR schemas; NUI does this, see §4), a schema registry tie-in (natscli `schema` commands), and diagnostics (`RAFTZ`, `IPQUEUESZ`, `PROFILEZ`).

---

## 3. Screens and their data sources

### 3.1 Screen table

| # | Screen | Purpose | Key widgets and data | Fed by (preferred → fallback) | Phase |
|---|---|---|---|---|---|
| 1 | **Connection manager** | Pick and switch NATS environments | Profile list with colour tag, auth form, test-connect, capability badges (SYS, JS, Monitoring, WS) | Client connect, `$SYS.REQ.USER.INFO`, `$JS.API.INFO`, `GET /varz`; natscli context files ([ADR-21](https://github.com/nats-io/nats-architecture-and-design/blob/main/adr/ADR-21.md)) | MVP |
| 2 | **Overview dashboard** | Is the system healthy right now? | KPI tiles (servers, conns, msgs/s, bytes/s, slow consumers, JS storage %), sparklines per server, version-skew warning, recent events | `$SYS.SERVER.*.STATSZ` (push, 10 s) → `/varz` poll; `JSZ`; `HEALTHZ` | MVP |
| 3 | **Connections** | Who is connected and who is slow | Virtualised table (cid, name, lang/version, account, user, ip, rtt, pending, msgs/bytes, subs, idle, uptime), sort and filter chips, closed tab with reason, side panel with subscriptions, Kick | `$SYS.REQ.SERVER.PING.CONNZ` (+ `auth`, `subs`, `state`) → `/connz`; `KICK`, `LDM` | MVP |
| 4 | **Subjects and subscriptions** | Where does interest exist? | Subject tree with sub counts, queue groups, "test subject" box | `SUBSZ` (`subs`, `test`) → `/subsz`; `CONNZ?subs=detail` | P2 |
| 5 | **Streams list** | Inventory of JetStream data | Table (name, subjects, storage, replicas, msgs, bytes, first/last ts, consumers, leader), filter by subject, health dot | `$JS.API.STREAM.LIST` (paged) → `/jsz?streams=true&acc=` | MVP |
| 6 | **Stream detail** | Understand one stream | Header stats, config view/edit, subject tree with counts, replica panel (current/lag/offline), sources/mirror lag, actions (purge, delete, step-down, peer evacuate) | `STREAM.INFO` (`subjects_filter`, `deleted_details`), `STREAM.UPDATE/PURGE/DELETE`, `LEADER.STEPDOWN`, `PEER.EVACUATE` | MVP (ops actions P2) |
| 7 | **Consumers** | Is anything falling behind? | Per-stream table (name, filter, ack policy, pending (lag), ack pending, redelivered, waiting, paused, last active), lag sparkline, detail, pause/resume, delete | `CONSUMER.LIST/INFO/PAUSE/DELETE`; `JSZ?consumers=true`; advisories `MAX_DELIVERIES`, `MSG_NAKED` | MVP |
| 8 | **Message browser** | Inspect stored messages | Seq/time/subject seek bar, list plus detail split, header table, payload viewer (JSON tree, text, hex), delete, "copy as CLI" | `DIRECT.GET` (`batch`, `next_by_subj`, `start_time`) → `STREAM.MSG.GET`; ordered consumer for streaming; `STREAM.MSG.DELETE` | MVP |
| 9 | **KV buckets** | Manage config-style data | Bucket list (from `KV_*` streams), key list with prefix filter, value editor, revision history timeline, live watch toggle, put/delete/purge | `@nats-io/kv` (`$KV.<b>.>` + Direct Get), `STREAM.NAMES?subject=$KV.>` | MVP |
| 10 | **Object store** | Browse blobs | Bucket list, object table (name, size, chunks, digest, mtime), upload/download progress, metadata, delete, seal | `@nats-io/obj` (`OBJ_<b>`, `$O.<b>.M.>`) | P2 |
| 11 | **Publish / request tool** | Send test traffic | Subject input with autocomplete (from subsz / stream subjects), header KV editor, payload editor (JSON, text, base64), request timeout, multi-reply mode, response pane with latency and status (503 = no responders), history | Core `publish`, `request`, `requestMany` ([ADR-47](https://github.com/nats-io/nats-architecture-and-design/blob/main/adr/ADR-47.md)) | MVP |
| 12 | **Live tail** | Watch traffic | Subject pattern input, streaming list with pause, rate meter, sampling, bounded ring buffer, highlight and filter, "save to stream" | Core `subscribe` with wildcards | MVP |
| 13 | **Accounts** | Multi-tenant view | Account table (conns, leafs, subs, sent/recv, slow consumers, JS enabled), detail (imports/exports graph, mappings, decoded JWT, revocations) | `ACCOUNTZ`, `$SYS.REQ.ACCOUNT.PING.STATZ` → `/accountz`, `/accstatz`; `$JS.API.INFO` for the tenant view | P2 |
| 14 | **Cluster topology** | How is it wired? | Graph: server nodes grouped by cluster, gateway edges between groups, leaf satellites; edge colour by RTT, node badge for meta leader; side panel with route list | `PING.VARZ`, `PING.ROUTEZ`, `PING.GATEWAYZ`, `PING.LEAFZ`, `PING.JSZ` (`meta_cluster`), `RAFTZ` | P2 |
| 15 | **Server info and config** | Per-server details | Identity, version, limits, listeners (client, cluster, gateway, leaf, ws, mqtt), TLS expiry, config load time and digest, tags/metadata, Reload button | `$SYS.REQ.SERVER.<id>.VARZ` → `/varz`; `RELOAD` | P2 |
| 16 | **Health and alerts** | What needs attention? | Per-server health with error list (account/stream/consumer), rule list (e.g. slow consumers > 0, consumer lag > N, JS storage > 80%, cert expiry < 14 d), event feed | `PING.HEALTHZ` (`details`), STATSZ, advisories `$JS.EVENT.ADVISORY.>`, `$SYS.SERVER.*.CLIENT.AUTH.ERR` | MVP (health), P2 (alerts) |
| 17 | **Events feed** | What just happened? | Filterable timeline of connect/disconnect, auth errors, leader elections, quorum lost, max deliveries | `$SYS.ACCOUNT.*.CONNECT/DISCONNECT`, `$SYS.SERVER.*.>` events, `$JS.EVENT.ADVISORY.>` | P2 |
| 18 | **Services** | Discover microservices | Service list (name, version, instances), endpoint stats (requests, errors, latency) | `$SRV.PING`, `$SRV.INFO`, `$SRV.STATS` ([ADR-32](https://github.com/nats-io/nats-architecture-and-design/blob/main/adr/ADR-32.md)) | P2 |

### 3.2 Notes per screen

- **Global shell.**
  - Top bar: environment switcher (colour-coded, so prod is red), account selector, and a capability indicator.
  - Left nav, grouped as: Observe (Overview, Connections, Subjects, Topology, Health, Events), JetStream (Streams, Consumers, KV, Object), Tools (Publish, Tail, Services), Admin (Accounts, Servers).
- **Permission-aware UI.** Disable rather than hide actions the current user cannot perform. `$SYS.REQ.USER.INFO` returns the user's permissions ([events.go L76](https://github.com/nats-io/nats-server/blob/v2.15.2/server/events.go#L76)).
- **Pagination everywhere.** `/connz` caps at 1024 by default and JS lists at 256 per page (see §1.1 and §1.3).

---

## 4. Prior art

| Tool | What it does | Source |
|---|---|---|
| **natscli (`nats`)** | The reference implementation for every operation a UI would offer: stream/consumer/KV/object management, pub/sub/req/reply, `server report` (connections, accounts, jetstream, health, gateways, leafnodes, CPU, mem), `server request` for every `$SYS` endpoint including `kick`, `server config reload`, `server watch`, `server check`, `events`, `top`, `trace`, `auth` (operator/account/user), `context` | [README](https://github.com/nats-io/natscli/blob/main/README.md), [server_command.go](https://github.com/nats-io/natscli/blob/main/cli/server_command.go), [server_report_command.go](https://github.com/nats-io/natscli/blob/main/cli/server_report_command.go), [server_request_command.go](https://github.com/nats-io/natscli/blob/main/cli/server_request_command.go) |
| **nats-top** | `top`-style terminal view built from `/varz` and `/connz` polling. The docs say its function now lives in `nats top` | [repo](https://github.com/nats-io/nats-top), [toputils.go L154-L167](https://github.com/nats-io/nats-top/blob/main/util/toputils.go#L154-L167), [legacy docs](https://github.com/nats-io/nats.docs/blob/master/using-nats/nats-tools/nats_top/README.md) |
| **NATS Surveyor** | Connects with a system account, polls `STATSZ` (plus JetStream advisories) from all servers, and exports Prometheus metrics. Ships Grafana dashboards (overview, clients, clusters, supercluster, JetStream state, network, node resources) | [README](https://github.com/nats-io/nats-surveyor/blob/main/README.md), [dashboards](https://github.com/nats-io/nats-surveyor/tree/main/docker-compose/grafana/provisioning/dashboards) |
| **prometheus-nats-exporter** | Scrapes `/varz`, `/connz`, `/routez`, `/jsz` into Prometheus. It is the documented path to Grafana | [repo](https://github.com/nats-io/prometheus-nats-exporter), [Prometheus & dashboards](https://docs.nats.io/learn/monitoring/prometheus-and-dashboards), [ecosystem](https://docs.nats.io/concepts/ecosystem) |
| **Synadia Control Plane** (commercial) | Central admin portal for multiple NATS systems: server and client monitoring, threshold alerts, account and user management, and stream, consumer and KV management. Requires decentralized (JWT) auth, and stores data in PostgreSQL plus Prometheus | [Get started](https://docs.synadia.com/platform/control-plane/guides), [Architecture](https://docs.synadia.com/platform/control-plane/architecture), [JetStream guide](https://docs.synadia.com/platform/control-plane/guides/jetstream) |
| **Server root page** | `GET /` on the monitoring port returns a minimal HTML index of endpoints, not a dashboard | [HandleRoot monitor.go L1516](https://github.com/nats-io/nats-server/blob/v2.15.2/server/monitor.go#L1516) |
| **NUI** (community, not official) | Open-source desktop and web GUI built with Go, Wails and React: pub/sub, request/reply, stream and KV management, message decoding (Protobuf, CBOR). Server metrics are listed as "coming soon" | [repo](https://github.com/nats-nui/nui) |

**Gap a new UI can fill.** Official tools are either the CLI or Prometheus/Grafana, which are metrics-only. NUI covers data, but not operations. Control Plane covers both, but it is commercial and needs JWT mode. An open UI that combines live operations (topology, health, consumer lag, events, kick and reload) with data tooling, and works in both static-config and JWT modes, has clear room.

---

## 5. Design guidance for a sleek, modern NATS console

**Information density**

- Ops users scan tables, so use compact 28–32 px rows, monospace for subjects, IDs and sequences, tabular numerals, and right-aligned numbers.
- Offer a density toggle.
- Use virtualised tables, because `/connz` can return thousands of rows.
- Format rates and bytes in human units, with exact values in tooltips.
- Always show *when* data was fetched, since monitoring data are snapshots ([Monitoring endpoints](https://docs.nats.io/learn/monitoring/monitoring-endpoints)).

**Dark theme first, light theme supported**

- Follow `prefers-color-scheme` ([MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-color-scheme)).
- Use dark grey surfaces rather than pure black, with elevation shown by lighter surfaces ([Material dark theme](https://m2.material.io/design/color/dark-theme.html)).
- Keep text and essential UI at WCAG AA contrast, 4.5:1 for body text ([WCAG 2.2 SC 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)).
- Reserve saturated colour for status: green ok, amber degraded, red error, and a distinct colour for "environment = prod".

**Command palette (Cmd/Ctrl+K)**

- Model it on the VS Code palette ([VS Code UI docs](https://code.visualstudio.com/docs/getstarted/userinterface)).
- Typed nouns jump to entities, e.g. `stream ORDERS`, `consumer ORDERS/shipping`, `conn 42`, `kv CONFIG/auth.user`, `server n1-east`.
- Verbs run actions, e.g. "Publish to…", "Tail orders.>", "Purge stream…", "Reload server…", "Switch context…".
- Show the equivalent `nats` CLI command for every action. It teaches users and doubles as a copyable audit trail.

**Real-time charts**

- Feed charts from the `STATSZ` push, every 10 s per server ([events.go L101](https://github.com/nats-io/nats-server/blob/v2.15.2/server/events.go#L101)), rather than tight HTTP polling.
- Compute rates client-side from counter deltas: `in_msgs`, `out_msgs`, `sent` and `received` are cumulative.
- Use a lightweight canvas chart library for many sparklines, for example [uPlot](https://github.com/leeoniya/uPlot).
- Pause animation under `prefers-reduced-motion` ([MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion)).
- For consumer lag, show `num_pending` over time with the ack-pending band.

**Stream subject tree**

- Build it from `STREAM.INFO` with `subjects_filter: ">"`, which returns a subject → count map paged at 100k ([jetstream_api.go L495](https://github.com/nats-io/nats-server/blob/v2.15.2/server/jetstream_api.go#L495)).
- Split on `.` into a collapsible tree with aggregated counts per node and a bar or heat cell for share of messages.
- Clicking a node opens the message browser filtered to `node.>`.
- Lazy-load for streams with very high subject cardinality: request `subjects_filter: "orders.*"` per level instead of `>`.

**Topology graph**

- Group servers into cluster "islands" (compound nodes). Draw gateway links as thick edges between islands and leaf nodes as smaller satellite nodes with dashed edges.
- Collapse pooled routes into one edge per peer pair, labelled with RTT.
- Badge the JetStream meta leader and stream leaders, and colour nodes by health (`HEALTHZ`).
- Use a stable layout (deterministic seeds, or a grouped layered layout) so nodes do not jump on refresh.

**Safety affordances**

- Destructive actions (purge, delete, kick, peer-remove, step-down, rescue) get type-to-confirm with the asset name and a CLI-equivalent preview.
- Require a stronger confirmation for system-account-only operations ([jetstream_api.go L212-L253](https://github.com/nats-io/nats-server/blob/v2.15.2/server/jetstream_api.go#L212-L253)).
- Show which account and user you are acting as at all times.

---

## Discrepancies found

| Item | Docs say | Source says |
|---|---|---|
| JSONP on monitoring endpoints | Legacy docs: supported via `?callback=` ([legacy](https://github.com/nats-io/nats.docs/blob/master/running-a-nats-service/nats_admin/monitoring/README.md#creating-monitoring-applications)) | Removed in v2.15.0 ([548e575](https://github.com/nats-io/nats-server/commit/548e57548b5dd95789b28b615a7990195a03b332)) |
| Monitoring authentication | Reference index: "Use authentication to protect monitoring endpoints" ([reference/system/monitor](https://docs.nats.io/reference/system/monitor)) | No auth mechanism in the monitor handlers. Use a proxy, a firewall, or `$SYS` instead |
| `max_subscriptions` reload | The learn guide says a reload rejects it ([Config management](https://docs.nats.io/learn/deployment/config-management)), and the reference marks it not-reloadable ([reference/config](https://docs.nats.io/reference/config/)) | Consistent with the source: there is no `maxsubs` case in `diffOptions`, so it falls through to "config reload not supported" ([reload.go L2005-L2016](https://github.com/nats-io/nats-server/blob/v2.15.2/server/reload.go#L2005-L2016)). Listed here only to confirm it was checked, not as a discrepancy |

## Unverified or uncertain

- **Error behaviour of `$SYS.REQ.*` monitoring requests.** I did not check whether they return structured errors the same way for every endpoint, and I did not test their timeouts.
- **Whether `/accstatz` has an exact `$SYS.REQ.SERVER.PING.ACCSTATZ` equivalent: unverified.** `ACCSTATZ` is not in the server-level `monSrvc` map in v2.15.2. The account-level `STATZ` via `$SYS.REQ.ACCOUNT.PING.STATZ` appears to be the equivalent.
- **CORS preflight.** Requests that add custom headers, for example an `Authorization` header for a proxy, will trigger a preflight that the server does not answer with `Access-Control-Allow-Headers`. This is inferred from the code, not tested.
- **Synadia Control Plane details** come from Synadia's own docs pages as summarised by a web fetch. I did not check the full product feature list or its KV support beyond the JetStream guide title.
- **NUI** is a community project. Its feature claims come from its README and were not tested.
- **Not checked for this research:** the `nats.go` client (only nats.js was inspected) and `nsc` source.
- **Design-guidance numbers** (row heights, refresh cadences) are recommendations, not taken from NATS sources.
