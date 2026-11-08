// messageSize is what max_payload limits: the payload plus the encoded headers.
export function messageSize(payload: string, headers: [string, string][]): number {
  const enc = new TextEncoder()
  let n = enc.encode(payload).length
  if (headers.length) n += "NATS/1.0\r\n".length + 2 + headers.reduce((a, [k, v]) => a + k.length + v.trim().length + 4, 0)
  return n
}
