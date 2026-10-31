import assert from "node:assert/strict"
import { test } from "node:test"

import { follow, MAX_TRACK, scrollTopFor } from "./scaled-scroll.ts"

const viewport = 600
const huge = 2_000_000 * 32 // two million 32 px rows

test("a list that fits the track scrolls natively", () => {
  assert.equal(follow({ scrollTop: 0, top: 0 }, 1234, viewport, 50_000), 1234)
  assert.equal(scrollTopFor(1234, viewport, 50_000), 1234)
})

test("on a scaled track a wheel step moves the list 1:1, not by the scale", () => {
  const top = follow({ scrollTop: 1000, top: 16_000 }, 1100, viewport, huge)
  assert.equal(top, 16_100)
})

test("dragging the scrollbar to the middle lands in the middle of the list", () => {
  const mid = (MAX_TRACK - viewport) / 2
  assert.equal(follow({ scrollTop: 0, top: 0 }, mid, viewport, huge), (huge - viewport) / 2)
})

test("the ends of the track are the ends of the list, even after 1:1 drift", () => {
  assert.equal(follow({ scrollTop: 300, top: 900 }, 0, viewport, huge), 0)
  assert.equal(follow({ scrollTop: MAX_TRACK - viewport - 50, top: 123 }, MAX_TRACK - viewport, viewport, huge), huge - viewport)
})

test("a programmatic jump round-trips: the scroll event it causes keeps the top", () => {
  const top = 40_000_000
  const scrollTop = scrollTopFor(top, viewport, huge)
  assert.ok(scrollTop < MAX_TRACK)
  assert.equal(follow({ scrollTop, top }, scrollTop, viewport, huge), top)
})
