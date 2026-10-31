import assert from "node:assert/strict"
import { test } from "node:test"

import { Ring, SLOTS } from "./ring.ts"

test("put keeps points by second and leaves skipped seconds empty", () => {
  const r = new Ring()
  r.put(100, 1)
  r.put(103, 4)
  assert.equal(r.at(100), 1)
  assert.ok(Number.isNaN(r.at(101)) && Number.isNaN(r.at(102)))
  assert.equal(r.at(103), 4)
  r.put(102, 9) // older than the newest
  assert.ok(Number.isNaN(r.at(102)))
})

test("a point an hour old is gone, even after a long gap wraps the ring", () => {
  const r = new Ring()
  r.put(100, 1)
  r.put(100 + SLOTS, 2)
  assert.ok(Number.isNaN(r.at(100)))
  r.put(100 + 3 * SLOTS + 5, 3)
  for (let s = 100 + 2 * SLOTS + 6; s < 100 + 3 * SLOTS + 5; s += 97) assert.ok(Number.isNaN(r.at(s)), `second ${s}`)
  assert.equal(r.at(100 + 3 * SLOTS + 5), 3)
})

test("load replaces the window, so a resumed view jumps to current values", () => {
  const r = new Ring()
  r.put(50, 7)
  r.load(1000, [1, null, 3])
  assert.ok(Number.isNaN(r.at(50)))
  assert.deepEqual([r.at(998), r.at(999), r.at(1000)].map((x) => (Number.isNaN(x) ? null : x)), [1, null, 3])
  assert.equal(r.last, 1000)
})
