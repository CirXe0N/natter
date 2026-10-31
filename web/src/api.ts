// The hand-written REST client. Response shapes come from Go via tygo (src/gen).
// Add one function per endpoint to `api`; screens call them from TanStack Query.
import type { Active, Context, Health, Info, JetStreamNames, NewContext, PassphraseChange, Ref, Settings, Vault } from "@/gen/api"

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, {
    method,
    signal,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error((await res.text()).trim() || res.statusText)
  return res.json() as Promise<T>
}

export const api = {
  info: (signal?: AbortSignal) => request<Info>("GET", "/api/info", undefined, signal),
  contexts: (signal?: AbortSignal) => request<Context[]>("GET", "/api/contexts", undefined, signal),
  activeContext: (signal?: AbortSignal) => request<Active>("GET", "/api/contexts/active", undefined, signal),
  activateContext: (ref: Ref) => request<Active>("PUT", "/api/contexts/active", { source: ref.source, name: ref.name }),
  health: (signal?: AbortSignal) => request<Health>("GET", "/api/health", undefined, signal),
  jetStreamNames: (signal?: AbortSignal) => request<JetStreamNames>("GET", "/api/jetstream/names", undefined, signal),
  setContextSettings: (ref: Ref, settings: Settings) =>
    request<Context>("PUT", `/api/contexts/${encodeURIComponent(ref.source)}/${encodeURIComponent(ref.name)}/settings`, settings),
  createContext: (c: NewContext) => request<Context>("POST", "/api/contexts", c),
  moveIntoVault: (ref: Ref, name?: string) =>
    request<Context>("POST", `/api/contexts/${encodeURIComponent(ref.source)}/${encodeURIComponent(ref.name)}/move-to-vault`, name ? { name } : {}),
  removeContext: (ref: Ref) => request<object>("POST", `/api/contexts/${encodeURIComponent(ref.source)}/${encodeURIComponent(ref.name)}/remove`, { confirm: true }),
  vault: (signal?: AbortSignal) => request<Vault>("GET", "/api/vault", undefined, signal),
  createVault: (passphrase: string) => request<Vault>("POST", "/api/vault", { passphrase }),
  unlockVault: (passphrase: string) => request<Vault>("POST", "/api/vault/unlock", { passphrase }),
  setPassphrase: (change: PassphraseChange) => request<Vault>("PUT", "/api/vault/passphrase", change),
  setKeyring: (on: boolean) => request<Vault>(on ? "POST" : "DELETE", "/api/vault/keyring"),
}
