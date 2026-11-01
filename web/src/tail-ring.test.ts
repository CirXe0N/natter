import assert from "node:assert/strict"
import { test } from "node:test"

import type { Tail } from "./gen/api.ts"
import { add, CAP, emptyRing, type Entry } from "./tail-ring.ts"

const frame = (ids: number[], more: Partial<Tail> = {}): Tail => ({
  rows: ids.map((id) => ({ id, time: "", subject: "s", size: 0, headers: 0, held: true })),
  heldFrom: 0,
  rate: 0,
  received: 0,
  pendingDrops: 0,
  rateDrops: 0,
  disconnects: 0,
  ...more,
})
const notes = (e: Entry[]) => e.flatMap((x) => ("note" in x ? [x.note] : []))
const ids = (e: Entry[]) => e.flatMap((x) => ("row" in x ? [x.row.id] : []))

test("an ID jump is a gap, named for why it happened", () => {
  let r = add(emptyRing, frame([]), false)
  r = add(r, frame([0, 1]), false)
  r = add(r, frame([5]), true)
  r = add(r, frame([9]), false)
  assert.deepEqual(notes(r.entries), ["3 messages not shown: this tab fell behind.", "3 messages not shown: paused."])
  assert.deepEqual(ids(r.entries), [0, 1, 5, 9])
})

test("a restarted tail starts a new epoch, so keys stay unique", () => {
  let r = add(emptyRing, frame([7, 8]), false)
  r = add(r, frame([0]), false)
  assert.match(notes(r.entries)[0], /restarted/)
  assert.equal(new Set(r.entries.map((e) => e.key)).size, r.entries.length)
})

test("a disconnect is an event with no count, but not one from before the tab joined", () => {
  let r = add(emptyRing, frame([], { disconnects: 2 }), false)
  assert.equal(r.entries.length, 0)
  r = add(r, frame([], { disconnects: 3, disconnect: "EOF" }), false)
  assert.match(notes(r.entries)[0], /closed the tail's connection \(EOF\).*not known/)
})

test("keeps at most CAP entries, dropping the oldest", () => {
  let r = add(emptyRing, frame(Array.from({ length: CAP }, (_, i) => i)), false)
  r = add(r, frame([CAP, CAP + 1]), false)
  assert.equal(r.entries.length, CAP)
  assert.equal(ids(r.entries)[0], 2)
})
