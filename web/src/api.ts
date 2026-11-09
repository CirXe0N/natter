// The hand-written REST client. Response shapes come from Go via tygo (src/gen).
// Add one function per endpoint to `api`; screens call them from TanStack Query.
import type { Active, Context, ContextUpdate, Health, Info, NewContext, PassphraseChange, Ref, Settings, Vault } from "@/gen/api"
import type { StreamDetail, StreamList, StreamSubjects } from "@/gen/api"
import type { Connections, ConnectionState, KickRequest } from "@/gen/api"
import type { FieldError, StreamPurge, StreamPurged, StreamSummary } from "@/gen/api"

// ApiError is a refusal; `field` names the config key a stream refusal is about.
export class ApiError extends Error {
  constructor(message: string, readonly field?: string) {
    super(message)
  }
}
import type { ConsumerDetail, ConsumerList, ConsumerSummary } from "@/gen/api"
import type { MessagePage, MessagePageRequest } from "@/gen/api"
import type { SendPreview, SendRequest, SendResult } from "@/gen/api"
import type { KVBucket, KVEntry } from "@/gen/api"
import type { Example, ExampleCopy } from "@/gen/api"
import type { Msg } from "@/gen/api"
import type { TailMessage } from "@/gen/api"

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, {
    method,
    signal,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    const text = (await res.text()).trim()
    if (res.headers.get("Content-Type")?.startsWith("application/json")) {
      const e = JSON.parse(text) as FieldError
      throw new ApiError(e.error, e.field)
    }
    throw new Error(text || res.statusText)
  }
  return res.json() as Promise<T>
}

export const api = {
  info: (signal?: AbortSignal) => request<Info>("GET", "/api/info", undefined, signal),
  contexts: (signal?: AbortSignal) => request<Context[]>("GET", "/api/contexts", undefined, signal),
  activeContext: (signal?: AbortSignal) => request<Active>("GET", "/api/contexts/active", undefined, signal),
  activateContext: (ref: Ref) => request<Active>("PUT", "/api/contexts/active", { source: ref.source, name: ref.name }),
  health: (signal?: AbortSignal) => request<Health>("GET", "/api/health", undefined, signal),
  setContextSettings: (ref: Ref, settings: Settings) =>
    request<Context>("PUT", `/api/contexts/${encodeURIComponent(ref.source)}/${encodeURIComponent(ref.name)}/settings`, settings),
  createContext: (c: NewContext) => request<Context>("POST", "/api/contexts", c),
  updateContext: (ref: Ref, u: ContextUpdate) => request<Context>("PUT", `/api/contexts/${encodeURIComponent(ref.source)}/${encodeURIComponent(ref.name)}`, u),
  moveIntoVault: (ref: Ref, name?: string) =>
    request<Context>("POST", `/api/contexts/${encodeURIComponent(ref.source)}/${encodeURIComponent(ref.name)}/move-to-vault`, name ? { name } : {}),
  removeContext: (ref: Ref) => request<object>("POST", `/api/contexts/${encodeURIComponent(ref.source)}/${encodeURIComponent(ref.name)}/remove`, { confirm: true }),
  vault: (signal?: AbortSignal) => request<Vault>("GET", "/api/vault", undefined, signal),
  createVault: (passphrase: string) => request<Vault>("POST", "/api/vault", { passphrase }),
  unlockVault: (passphrase: string) => request<Vault>("POST", "/api/vault/unlock", { passphrase }),
  setPassphrase: (change: PassphraseChange) => request<Vault>("PUT", "/api/vault/passphrase", change),
  connections: (state: ConnectionState, signal?: AbortSignal) => request<Connections>("GET", `/api/connections?state=${state}`, undefined, signal),
  kick: (k: KickRequest) => request<object>("POST", "/api/connections/kick", k),
  setKeyring: (on: boolean) => request<Vault>(on ? "POST" : "DELETE", "/api/vault/keyring"),
  streams: (subject: string, signal?: AbortSignal) => request<StreamList>("GET", `/api/streams?${new URLSearchParams({ subject })}`, undefined, signal),
  stream: (name: string, signal?: AbortSignal) => request<StreamDetail>("GET", `/api/streams/${encodeURIComponent(name)}`, undefined, signal),
  streamSubjects: (name: string, filter: string, signal?: AbortSignal) =>
    request<StreamSubjects>("GET", `/api/streams/${encodeURIComponent(name)}/subjects?${new URLSearchParams({ filter })}`, undefined, signal),
  createStream: (config: object) => request<StreamSummary>("POST", "/api/streams", config),
  updateStream: (name: string, config: object) => request<StreamSummary>("PUT", `/api/streams/${encodeURIComponent(name)}`, config),
  purgeStream: (name: string, p: StreamPurge) => request<StreamPurged>("POST", `/api/streams/${encodeURIComponent(name)}/purge`, p),
  deleteStream: (name: string) => request<object>("DELETE", `/api/streams/${encodeURIComponent(name)}`, { confirm: name }),
  consumers: (stream: string, signal?: AbortSignal) => request<ConsumerList>("GET", `/api/streams/${encodeURIComponent(stream)}/consumers`, undefined, signal),
  consumer: (stream: string, name: string, signal?: AbortSignal) =>
    request<ConsumerDetail>("GET", `/api/streams/${encodeURIComponent(stream)}/consumers/${encodeURIComponent(name)}`, undefined, signal),
  pauseConsumer: (stream: string, name: string, seconds: number) =>
    request<ConsumerSummary>("PUT", `/api/streams/${encodeURIComponent(stream)}/consumers/${encodeURIComponent(name)}/pause`, { seconds }),
  resumeConsumer: (stream: string, name: string) =>
    request<ConsumerSummary>("DELETE", `/api/streams/${encodeURIComponent(stream)}/consumers/${encodeURIComponent(name)}/pause`),
  createConsumer: (stream: string, config: object) => request<ConsumerSummary>("POST", `/api/streams/${encodeURIComponent(stream)}/consumers`, config),
  updateConsumer: (stream: string, name: string, config: object) =>
    request<ConsumerSummary>("PUT", `/api/streams/${encodeURIComponent(stream)}/consumers/${encodeURIComponent(name)}`, config),
  deleteConsumer: (stream: string, name: string) => request<object>("DELETE", `/api/streams/${encodeURIComponent(stream)}/consumers/${encodeURIComponent(name)}`),
  browse: (stream: string, req: MessagePageRequest, signal?: AbortSignal) =>
    request<MessagePage>("POST", `/api/streams/${encodeURIComponent(stream)}/messages`, req, signal),
  send: (r: SendRequest) => request<SendResult>("POST", "/api/send", r),
  sendPreview: (r: SendRequest, signal?: AbortSignal) => request<SendPreview>("POST", "/api/send/preview", r, signal),
  examples: (signal?: AbortSignal) => request<Example[]>("GET", "/api/examples", undefined, signal),
  createExample: (e: Omit<Example, "id">) => request<Example>("POST", "/api/examples", e),
  updateExample: (e: Example) => request<Example>("PUT", `/api/examples/${encodeURIComponent(e.id)}`, e),
  deleteExample: (id: string) => request<object>("DELETE", `/api/examples/${encodeURIComponent(id)}`),
  copyExamples: (c: ExampleCopy) => request<Example[]>("POST", "/api/examples/copy", c),
  // keepalive so it still goes out while the page unloads
  closeBrowsing: (view: string) => void fetch(`/api/browsing/${encodeURIComponent(view)}`, { method: "DELETE", keepalive: true }),
  kvBuckets: (signal?: AbortSignal) => request<KVBucket[]>("GET", "/api/kv", undefined, signal),
  createBucket: (config: object) => request<KVBucket>("POST", "/api/kv", config),
  // nats.go's KeyValueConfig, the shape createBucket and updateBucket take
  bucketConfig: (bucket: string, signal?: AbortSignal) => request<{ [key: string]: unknown }>("GET", `/api/kv/${encodeURIComponent(bucket)}`, undefined, signal),
  updateBucket: (bucket: string, config: object) => request<KVBucket>("PUT", `/api/kv/${encodeURIComponent(bucket)}`, config),
  deleteBucket: (bucket: string) => request<object>("DELETE", `/api/kv/${encodeURIComponent(bucket)}`, { confirm: bucket }),
  kvHistory: (bucket: string, key: string, signal?: AbortSignal) =>
    request<KVEntry[]>("GET", `/api/kv/${encodeURIComponent(bucket)}/history/${encodeURIComponent(key)}`, undefined, signal),
  // raw bytes of one revision's value for the PayloadViewer, as payloadUrl
  kvValueUrl: (bucket: string, key: string, revision: number) => `/api/kv/${encodeURIComponent(bucket)}/keys/${encodeURIComponent(key)}?revision=${revision}`,
  message: (stream: string, seq: number, signal?: AbortSignal) => request<Msg>("GET", `/api/streams/${encodeURIComponent(stream)}/messages/${seq}`, undefined, signal),
  // raw bytes for the PayloadViewer: Range requests work, ?download saves a file
  payloadUrl: (stream: string, seq: number) => `/api/streams/${encodeURIComponent(stream)}/messages/${seq}/payload`,
  deleteMessage: (stream: string, seq: number, erase: boolean) => request<object>("DELETE", `/api/streams/${encodeURIComponent(stream)}/messages/${seq}`, { erase }),
  kvPut: async (bucket: string, key: string, value: string) => {
    const res = await fetch(`/api/kv/${encodeURIComponent(bucket)}/keys/${encodeURIComponent(key)}`, { method: "PUT", body: value })
    if (!res.ok) throw new Error((await res.text()).trim() || res.statusText)
  },
  kvDelete: (bucket: string, key: string, purge: boolean) =>
    request<unknown>("DELETE", `/api/kv/${encodeURIComponent(bucket)}/keys/${encodeURIComponent(key)}${purge ? "?purge=true" : ""}`),
  tailMessage: (filter: string, id: number, signal?: AbortSignal) =>
    request<TailMessage>("GET", `/api/tail/message?${new URLSearchParams({ filter, id: String(id) })}`, undefined, signal),
}
