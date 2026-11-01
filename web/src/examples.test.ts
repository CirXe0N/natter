import assert from "node:assert/strict"
import { test } from "node:test"

import { conflicts } from "./examples.ts"
import type { Example } from "./gen/api.ts"

const ex = (id: string, context: string, folder: string, name: string): Example => ({ id, context, folder, name, mode: "pub", subject: "a", headers: [], payload: "" })

test("an Example conflicts only with the same folder and name on the target Context", () => {
  const all = [ex("1", "dev", "f", "a"), ex("2", "dev", "f", "b"), ex("3", "dev", "", "a"), ex("4", "prod", "f", "a"), ex("5", "other", "f", "b")]
  assert.deepEqual(conflicts(all, ["1", "2", "3"], "prod").map((e) => e.id), ["1"])
  assert.deepEqual(conflicts(all, ["1"], "empty"), [])
})
