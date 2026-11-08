import assert from "node:assert/strict"
import { test } from "node:test"

import { messageSize } from "./send.ts"

test("messageSize counts payload bytes and encoded headers like the server", () => {
  assert.equal(messageSize("héllo", []), 6)
  assert.equal(messageSize("", [["K", "v"]]), 10 + 2 + 1 + 1 + 4)
})
