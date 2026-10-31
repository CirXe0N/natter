// PROTOTYPE: in-memory mock data only. Nothing here talks to NATS.

export type SecretStorage = "vault" | "op" | "env" | "nsc" | "plaintext";

export type Context = {
  name: string;
  description: string;
  urls: string;
  user: string;
  secret: SecretStorage;
  hasSystemCreds: boolean;
  monitoringUrl?: string;
  readOnly: boolean;
  source: "cli" | "app";
  mode: "static" | "jwt";
};

export const contexts: Context[] = [
  { name: "local", description: "Docker compose dev server", urls: "nats://127.0.0.1:4222", user: "dev", secret: "vault", hasSystemCreds: true, readOnly: false, source: "app", mode: "static" },
  { name: "staging", description: "3-node cluster, eu-west", urls: "nats://stg-1:4222,nats://stg-2:4222,nats://stg-3:4222", user: "ops", secret: "op", hasSystemCreds: true, readOnly: false, source: "cli", mode: "jwt" },
  { name: "prod", description: "Production supercluster", urls: "tls://nats.prod.internal:4222", user: "ops", secret: "nsc", hasSystemCreds: true, readOnly: true, source: "cli", mode: "jwt" },
  { name: "orders-svc", description: "App user, no system access", urls: "nats://stg-1:4222", user: "orders", secret: "env", hasSystemCreds: false, readOnly: false, source: "cli", mode: "jwt" },
  { name: "legacy", description: "Old laptop context", urls: "nats://10.0.4.12:4222", user: "admin", secret: "plaintext", hasSystemCreds: false, monitoringUrl: "http://10.0.4.12:8222", readOnly: false, source: "cli", mode: "static" },
];

export const secretLabel: Record<SecretStorage, string> = {
  vault: "Vault",
  op: "1Password (op://)",
  env: "Env (env://)",
  nsc: "nsc (nsc://)",
  plaintext: "Plaintext secret",
};

export type Server = { name: string; version: string; cluster: string; conns: number; mem: string; cpu: number; healthy: boolean; uptime: string; jsLeader?: boolean };

export const servers: Server[] = [
  { name: "stg-1", version: "2.15.2", cluster: "eu-west", conns: 142, mem: "312 MiB", cpu: 7, healthy: true, uptime: "12d 4h", jsLeader: true },
  { name: "stg-2", version: "2.15.2", cluster: "eu-west", conns: 128, mem: "298 MiB", cpu: 6, healthy: true, uptime: "12d 4h" },
  { name: "stg-3", version: "2.15.1", cluster: "eu-west", conns: 96, mem: "341 MiB", cpu: 11, healthy: false, uptime: "3h 12m" },
];

export type Connection = { cid: number; name: string; ip: string; lang: string; version: string; account: string; subs: number; pending: number; inMsgs: number; outMsgs: number; rtt: string; uptime: string; server: string; slow?: boolean };

const langs = [["go", "1.55.0"], ["javascript", "3.4.0"], ["python3", "2.12.0"], ["rust", "0.44.0"], ["java", "2.24.1"]];
const names = ["orders-api", "billing-worker", "inventory-sync", "notifier", "gateway-edge", "audit-sink", "search-indexer", "natter", "cron-runner", "session-svc"];
export const connections: Connection[] = Array.from({ length: 34 }, (_, i) => {
  const [lang, version] = langs[i % langs.length];
  return {
    cid: 1000 + i * 7,
    name: `${names[i % names.length]}${i >= names.length ? `-${Math.floor(i / names.length)}` : ""}`,
    ip: `10.0.${(i * 3) % 16}.${20 + i}`,
    lang,
    version,
    account: i % 4 === 0 ? "BILLING" : "ORDERS",
    subs: 2 + ((i * 13) % 40),
    pending: i === 5 ? 48213 : (i * 97) % 300,
    inMsgs: 12000 + i * 3911,
    outMsgs: 9000 + i * 5113,
    rtt: `${(0.3 + ((i * 7) % 20) / 10).toFixed(1)}ms`,
    uptime: `${1 + (i % 9)}d ${i % 24}h`,
    server: servers[i % 3].name,
    slow: i === 5,
  };
});

export type Consumer = { name: string; stream: string; durable: boolean; filter: string; ackPolicy: string; pending: number; ackPending: number; redelivered: number; waiting: number; lastActive: string; paused?: boolean };

export type Stream = {
  name: string;
  subjects: string[];
  storage: "file" | "memory";
  replicas: number;
  retention: "limits" | "interest" | "workqueue";
  messages: number;
  bytes: string;
  firstSeq: number;
  lastSeq: number;
  consumers: number;
  maxAge: string;
  lastActivity: string;
  kind: "stream" | "kv" | "obj";
};

export const streams: Stream[] = [
  { name: "ORDERS", subjects: ["orders.>"], storage: "file", replicas: 3, retention: "limits", messages: 1_284_331, bytes: "1.9 GiB", firstSeq: 412_002, lastSeq: 1_696_332, consumers: 4, maxAge: "30d", lastActivity: "now", kind: "stream" },
  { name: "EVENTS", subjects: ["events.*.*", "audit.>"], storage: "file", replicas: 3, retention: "interest", messages: 88_120, bytes: "142 MiB", firstSeq: 9_870_221, lastSeq: 9_958_340, consumers: 2, maxAge: "7d", lastActivity: "2s ago", kind: "stream" },
  { name: "JOBS", subjects: ["jobs.>"], storage: "file", replicas: 1, retention: "workqueue", messages: 312, bytes: "880 KiB", firstSeq: 55_001, lastSeq: 55_312, consumers: 1, maxAge: "∞", lastActivity: "14s ago", kind: "stream" },
  { name: "METRICS", subjects: ["metrics.>"], storage: "memory", replicas: 1, retention: "limits", messages: 50_000, bytes: "38 MiB", firstSeq: 2_100_001, lastSeq: 2_150_000, consumers: 1, maxAge: "1h", lastActivity: "now", kind: "stream" },
  { name: "KV_config", subjects: ["$KV.config.>"], storage: "file", replicas: 3, retention: "limits", messages: 41, bytes: "22 KiB", firstSeq: 1, lastSeq: 187, consumers: 0, maxAge: "∞", lastActivity: "3m ago", kind: "kv" },
  { name: "KV_sessions", subjects: ["$KV.sessions.>"], storage: "memory", replicas: 1, retention: "limits", messages: 2_340, bytes: "1.1 MiB", firstSeq: 80_221, lastSeq: 91_004, consumers: 0, maxAge: "30m", lastActivity: "now", kind: "kv" },
  { name: "OBJ_assets", subjects: ["$O.assets.>"], storage: "file", replicas: 3, retention: "limits", messages: 1_204, bytes: "612 MiB", firstSeq: 1, lastSeq: 1_204, consumers: 0, maxAge: "∞", lastActivity: "1d ago", kind: "obj" },
];

export const consumers: Consumer[] = [
  { name: "fulfillment", stream: "ORDERS", durable: true, filter: "orders.created", ackPolicy: "explicit", pending: 12, ackPending: 3, redelivered: 0, waiting: 4, lastActive: "now" },
  { name: "billing", stream: "ORDERS", durable: true, filter: "orders.*", ackPolicy: "explicit", pending: 18_442, ackPending: 512, redelivered: 37, waiting: 0, lastActive: "4m ago" },
  { name: "analytics", stream: "ORDERS", durable: true, filter: "orders.>", ackPolicy: "none", pending: 0, ackPending: 0, redelivered: 0, waiting: 1, lastActive: "now" },
  { name: "refunds", stream: "ORDERS", durable: true, filter: "orders.refunded", ackPolicy: "explicit", pending: 220, ackPending: 0, redelivered: 0, waiting: 0, lastActive: "2h ago", paused: true },
  { name: "audit-sink", stream: "EVENTS", durable: true, filter: "audit.>", ackPolicy: "explicit", pending: 4, ackPending: 1, redelivered: 0, waiting: 2, lastActive: "now" },
  { name: "alerts", stream: "EVENTS", durable: true, filter: "events.*.error", ackPolicy: "explicit", pending: 0, ackPending: 0, redelivered: 2, waiting: 1, lastActive: "1m ago" },
  { name: "worker", stream: "JOBS", durable: true, filter: "jobs.>", ackPolicy: "explicit", pending: 312, ackPending: 16, redelivered: 5, waiting: 8, lastActive: "now" },
  { name: "downsampler", stream: "METRICS", durable: true, filter: "metrics.>", ackPolicy: "all", pending: 90, ackPending: 0, redelivered: 0, waiting: 1, lastActive: "now" },
];

export type Message = { seq: number; subject: string; time: string; size: number; headers: Record<string, string>; payload: string; kind: "json" | "text" | "binary" };

const orderJson = (id: number, status: string) =>
  JSON.stringify({ id: `ord_${id}`, status, customer: { id: `cus_${(id * 37) % 9000}`, tier: id % 3 ? "standard" : "gold" }, items: [{ sku: "SKU-1182", qty: 2, price: 19.99 }, { sku: "SKU-4410", qty: 1, price: 149 }], total: 188.98, currency: "EUR" });

export const messages: Message[] = Array.from({ length: 40 }, (_, i) => {
  const seq = 1_696_332 - i;
  const statuses = ["created", "paid", "shipped", "refunded"];
  const status = statuses[i % 4];
  const base = { seq, subject: `orders.${status}`, time: `2026-10-31 14:${String(59 - (i % 60)).padStart(2, "0")}:${String((i * 17) % 60).padStart(2, "0")}`, headers: { "Nats-Msg-Id": `ord_${88000 + i}-${status}`, "Content-Type": "application/json" } as Record<string, string> };
  if (i === 6) return { ...base, subject: "orders.note", headers: { "Content-Type": "text/plain" }, payload: "Customer asked to leave the parcel with the neighbour at no. 14.", kind: "text" as const, size: 64 };
  if (i === 11) return { ...base, subject: "orders.label", headers: { "Content-Type": "application/octet-stream" }, payload: "89504e470d0a1a0a0000000d4948445200000190000000c80806000000a3f5a1e40000000173524742", kind: "binary" as const, size: 18_204 };
  const payload = orderJson(88000 + i, status);
  return { ...base, payload, kind: "json" as const, size: payload.length };
});

export type KvEntry = { key: string; value: string; revision: number; updated: string; op?: "PUT" | "DEL" };

export const kvBuckets = [
  { name: "config", keys: 41, history: 10, ttl: "∞", storage: "file", replicas: 3, size: "22 KiB" },
  { name: "sessions", keys: 2_340, history: 1, ttl: "30m", storage: "memory", replicas: 1, size: "1.1 MiB" },
  { name: "feature-flags", keys: 18, history: 5, ttl: "∞", storage: "file", replicas: 3, size: "4 KiB" },
];

export const kvEntries: KvEntry[] = [
  { key: "app.checkout.timeout_ms", value: "4500", revision: 187, updated: "3m ago" },
  { key: "app.checkout.retries", value: "3", revision: 160, updated: "2d ago" },
  { key: "app.payments.provider", value: '{"name":"stripe","region":"eu","fallback":"adyen"}', revision: 152, updated: "5d ago" },
  { key: "app.search.index", value: "products-v7", revision: 149, updated: "6d ago" },
  { key: "app.banner.text", value: "Free shipping over €50 this weekend", revision: 181, updated: "1h ago" },
  { key: "db.pool.max", value: "64", revision: 98, updated: "21d ago" },
  { key: "db.pool.min", value: "8", revision: 97, updated: "21d ago" },
  { key: "svc.notifier.enabled", value: "true", revision: 176, updated: "4h ago" },
];

export const kvHistory: KvEntry[] = [
  { key: "app.checkout.timeout_ms", value: "4500", revision: 187, updated: "3m ago", op: "PUT" },
  { key: "app.checkout.timeout_ms", value: "3000", revision: 171, updated: "2d ago", op: "PUT" },
  { key: "app.checkout.timeout_ms", value: "", revision: 165, updated: "3d ago", op: "DEL" },
  { key: "app.checkout.timeout_ms", value: "2500", revision: 120, updated: "14d ago", op: "PUT" },
];

// Live tail generator: fakes a busy server so the rate cap and dropped counter show up.
let tailSeq = 0;
const tailSubjects = ["orders.created", "orders.paid", "events.web.click", "events.api.error", "metrics.cpu", "jobs.email.send", "audit.login"];
export function nextTailMessage(): Message {
  tailSeq++;
  const subject = tailSubjects[Math.floor(Math.random() * tailSubjects.length)];
  const payload = subject.startsWith("metrics")
    ? JSON.stringify({ host: `stg-${1 + (tailSeq % 3)}`, value: +(Math.random() * 100).toFixed(1) })
    : subject.startsWith("orders")
      ? orderJson(90000 + tailSeq, subject.split(".")[1])
      : JSON.stringify({ id: tailSeq, at: new Date().toISOString() });
  return { seq: tailSeq, subject, time: new Date().toLocaleTimeString(), size: payload.length, headers: {}, payload, kind: "json" };
}

export function randomWalk(n: number, start: number, jitter: number): number[] {
  const out = [start];
  for (let i = 1; i < n; i++) out.push(Math.max(0, out[i - 1] + (Math.random() - 0.5) * jitter));
  return out;
}

export const cliFor = {
  streamInfo: (s: string) => `nats stream info ${s}`,
  streamPurge: (s: string) => `nats stream purge ${s} -f`,
  streamDelete: (s: string) => `nats stream rm ${s} -f`,
  consumerInfo: (s: string, c: string) => `nats consumer info ${s} ${c}`,
  msgGet: (s: string, seq: number) => `nats stream get ${s} ${seq}`,
  kvGet: (b: string, k: string) => `nats kv get ${b} ${k}`,
  kvPut: (b: string, k: string, v: string) => `nats kv put ${b} ${k} '${v}'`,
  kick: (cid: number) => `nats server request kick ${cid}`,
  connz: () => `nats server report connections`,
  sub: (s: string) => `nats sub '${s}'`,
  pub: (s: string) => `nats pub ${s} '<payload>'`,
  req: (s: string) => `nats req ${s} '<payload>' --timeout 2s`,
  ctx: (c: string) => `nats context select ${c}`,
};

// ---------- Large-stream browsing (virtualised) ----------
// Row metadata as the backend would get it from a headers_only consumer: no payload, just size.
export type MsgMeta = { seq: number; subject: string; time: string; size: number; headers: number; preview?: string; kind: Message["kind"] };

const LARGE = 4 * 1024 * 1024;
const statuses = ["created", "paid", "shipped", "refunded"];
/** Cheap: subject only, so filters can scan a million rows. */
export function subjectAt(seq: number) {
  return seq % 23 === 0 ? "orders.export.batch" : seq % 41 === 0 ? "orders.label" : `orders.${statuses[seq % 4]}`;
}

export function metaAt(seq: number): MsgMeta {
  const status = statuses[seq % 4];
  const t = new Date(Date.UTC(2026, 9, 31, 15, 0, 0) - (1_696_332 - seq) * 1900);
  const time = t.toISOString().replace("T", " ").slice(0, 23);
  if (seq % 23 === 0) return { seq, subject: "orders.export.batch", time, size: LARGE - (seq % 1000), headers: 3, kind: "json" };
  if (seq % 41 === 0) return { seq, subject: "orders.label", time, size: 182_044, headers: 2, kind: "binary" };
  const preview = orderJson(seq, status);
  return { seq, subject: `orders.${status}`, time, size: preview.length, headers: 2, preview, kind: "json" };
}

/** What the drawer gets after a Direct Get of one message. Large payloads arrive truncated for display. */
export function messageAt(seq: number): Message & { truncatedAt?: number } {
  const m = metaAt(seq);
  const headers: Record<string, string> = { "Nats-Msg-Id": `ord_${seq}`, "Content-Type": m.kind === "binary" ? "application/pdf" : "application/json" };
  if (m.subject === "orders.export.batch") {
    headers["X-Export-Rows"] = "18240";
    const rows = Array.from({ length: 40 }, (_, i) => ({ id: `ord_${seq - i}`, status: "paid", total: +(Math.random() * 400).toFixed(2), currency: "EUR" }));
    return { seq, subject: m.subject, time: m.time, size: m.size, headers, kind: "json", payload: JSON.stringify({ export: "daily", rows }), truncatedAt: 64 * 1024 };
  }
  if (m.kind === "binary") return { seq, subject: m.subject, time: m.time, size: m.size, headers, kind: "binary", payload: "255044462d312e370a25e2e3cfd30a312030206f626a0a3c3c2f547970652f436174616c6f672f50616765732032203020523e3e0a656e646f626a0a" };
  return { seq, subject: m.subject, time: m.time, size: m.size, headers, kind: "json", payload: m.preview! };
}

export function fmtBytes(n: number) {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

// ---------- Example messages (publish/request library) ----------
/** An Example message belongs to exactly one Context (by name). */
export type Example = { id: string; context: string; name: string; folder: string; mode: "pub" | "req"; subject: string; headers: [string, string][]; payload: string; timeoutMs?: number };

export const initialExamples: Example[] = [
  { id: "e1", context: "staging", folder: "orders", name: "New order (standard)", mode: "pub", subject: "orders.created", headers: [["Content-Type", "application/json"], ["Nats-Msg-Id", "test-{{ID}}"]], payload: `{
  "id": "ord_{{ID}}",
  "status": "created",
  "created_at": "{{TimeStamp}}",
  "customer": { "id": "cus_42", "tier": "standard" },
  "items": [{ "sku": "SKU-1182", "qty": 2, "price": 19.99 }],
  "total": 39.98,
  "currency": "EUR",
  "note": "load test message {{Count}}"
}` },
  { id: "e2", context: "staging", folder: "orders", name: "New order (gold, multi-item)", mode: "pub", subject: "orders.created", headers: [["Content-Type", "application/json"]], payload: JSON.stringify({ id: "ord_test_2", status: "created", customer: { id: "cus_7", tier: "gold" }, items: [{ sku: "SKU-1182", qty: 1, price: 19.99 }, { sku: "SKU-4410", qty: 3, price: 149 }], total: 466.99, currency: "EUR" }, null, 2) },
  { id: "e3", context: "staging", folder: "orders", name: "Refund", mode: "pub", subject: "orders.refunded", headers: [["Content-Type", "application/json"]], payload: JSON.stringify({ id: "ord_test_1", status: "refunded", reason: "damaged" }, null, 2) },
  { id: "e4", context: "staging", folder: "inventory", name: "Stock lookup", mode: "req", subject: "svc.inventory.lookup", headers: [], payload: JSON.stringify({ sku: "SKU-1182" }, null, 2), timeoutMs: 2000 },
  { id: "e5", context: "staging", folder: "inventory", name: "Stock lookup (unknown SKU)", mode: "req", subject: "svc.inventory.lookup", headers: [], payload: JSON.stringify({ sku: "DOES-NOT-EXIST" }, null, 2), timeoutMs: 2000 },
  { id: "e6", context: "staging", folder: "pricing", name: "Quote EUR", mode: "req", subject: "svc.pricing.quote", headers: [["X-Tenant", "acme"]], payload: JSON.stringify({ sku: "SKU-4410", qty: 3, currency: "EUR" }, null, 2), timeoutMs: 1000 },
  { id: "e7", context: "staging", folder: "health", name: "Service ping", mode: "req", subject: "$SRV.PING", headers: [], payload: "", timeoutMs: 500 },
  { id: "e8", context: "local", folder: "smoke", name: "Hello world", mode: "pub", subject: "dev.hello", headers: [], payload: "hello from natter" },
  { id: "e9", context: "local", folder: "orders", name: "New order (standard)", mode: "pub", subject: "orders.created", headers: [["Content-Type", "application/json"]], payload: JSON.stringify({ id: "ord_local_1", status: "created", total: 9.99, currency: "EUR" }, null, 2) },
  { id: "e10", context: "prod", folder: "health", name: "Service ping", mode: "req", subject: "$SRV.PING", headers: [], payload: "", timeoutMs: 500 },
];
