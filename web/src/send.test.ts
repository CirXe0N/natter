import assert from "node:assert/strict"
import { test } from "node:test"

import { messageSize, sendCli } from "./send.ts"

test("sendCli builds nats pub and nats request with quoting, headers, timeout and Context", () => {
  assert.equal(sendCli({ mode: "pub", subject: "orders.new", headers: [], payload: "hi", timeoutMs: 0 }), "nats pub orders.new hi")
  assert.equal(
    sendCli({ mode: "req", subject: "svc.echo", headers: [["X-A", "it's"]], payload: '{"a":1}', timeoutMs: 500 }, "my ctx"),
    `nats --context 'my ctx' request svc.echo '{"a":1}' -H 'X-A:it'\\''s' --timeout 500ms`,
  )
  assert.equal(sendCli({ mode: "pub", subject: "a", headers: [], payload: "", timeoutMs: 0 }), "nats pub a ''")
})

test("messageSize counts payload bytes and encoded headers like the server", () => {
  assert.equal(messageSize("héllo", []), 6)
  assert.equal(messageSize("", [["K", "v"]]), 10 + 2 + 1 + 1 + 4)
})
