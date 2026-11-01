import type { SendRequest } from "./gen/api.ts"
import { shellQuote } from "./stream-config.ts"

// sendCli is the natscli command that does the same send. context is the name of
// the active Context when it is a CLI Context, so the command targets the same server.
export function sendCli(r: SendRequest, context?: string): string {
  const parts = ["nats"]
  if (context) parts.push("--context", shellQuote(context))
  parts.push(r.mode === "pub" ? "pub" : "request", shellQuote(r.subject), shellQuote(r.payload))
  for (const [k, v] of r.headers) parts.push("-H", shellQuote(`${k}:${v}`))
  if (r.mode === "req" && r.timeoutMs > 0) parts.push("--timeout", `${r.timeoutMs}ms`)
  return parts.join(" ")
}

// messageSize is what max_payload limits: the payload plus the encoded headers.
export function messageSize(payload: string, headers: [string, string][]): number {
  const enc = new TextEncoder()
  let n = enc.encode(payload).length
  if (headers.length) n += "NATS/1.0\r\n".length + 2 + headers.reduce((a, [k, v]) => a + k.length + v.trim().length + 4, 0)
  return n
}
