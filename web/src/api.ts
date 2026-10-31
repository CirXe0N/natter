// The hand-written REST client. Response shapes come from Go via tygo (src/gen).
// Add one function per endpoint to `api`; screens call them from TanStack Query.
import type { Active, Context, Info, JetStreamNames, NewContext, Ref, Settings, Vault } from "@/gen/api"

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, {
    method,
    signal,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new ApiError(res.status, (await res.text()).trim() || res.statusText)
  return res.json() as Promise<T>
}

export const api = {
  info: (signal?: AbortSignal) => request<Info>("GET", "/api/info", undefined, signal),
  contexts: (signal?: AbortSignal) => request<Context[]>("GET", "/api/contexts", undefined, signal),
  activeContext: (signal?: AbortSignal) => request<Active>("GET", "/api/contexts/active", undefined, signal),
  activateContext: (ref: Ref) => request<Active>("PUT", "/api/contexts/active", { source: ref.source, name: ref.name }),
  jetStreamNames: (signal?: AbortSignal) => request<JetStreamNames>("GET", "/api/jetstream/names", undefined, signal),
  setContextSettings: (ref: Ref, settings: Settings) =>
    request<Context>("PUT", `/api/contexts/${encodeURIComponent(ref.source)}/${encodeURIComponent(ref.name)}/settings`, settings),
  createContext: (c: NewContext) => request<Context>("POST", "/api/contexts", c),
  vault: (signal?: AbortSignal) => request<Vault>("GET", "/api/vault", undefined, signal),
  createVault: (passphrase: string) => request<Vault>("POST", "/api/vault", { passphrase }),
  unlockVault: (passphrase: string) => request<Vault>("POST", "/api/vault/unlock", { passphrase }),
}
