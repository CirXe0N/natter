// The hand-written REST client. Response shapes come from Go via tygo (src/gen).
// Add one function per endpoint to `api`; screens call them from TanStack Query.
import type { Info } from "@/gen/api"

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
}
