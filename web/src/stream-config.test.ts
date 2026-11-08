import assert from "node:assert/strict"
import { test } from "node:test"

import { formatDuration, parseDuration, toConfig, toValues } from "./stream-config.ts"

test("durations round trip", () => {
  assert.equal(parseDuration("1h30m"), 5400e9)
  assert.equal(parseDuration("7d"), 7 * 864e11)
  assert.equal(parseDuration("soon"), undefined)
  assert.equal(formatDuration(5400e9), "1h30m")
})

test("a form edit keeps the config keys the form does not show", () => {
  const base = { name: "A", subjects: ["a.>"], storage: "file", num_replicas: 1, mirror: { name: "B" }, max_msgs: -1 }
  const { config, errors } = toConfig(base, { ...toValues(base), max_msgs: "10", max_age: "2h" })
  assert.deepEqual(errors, {})
  assert.deepEqual({ mirror: config.mirror, max_msgs: config.max_msgs, max_age: config.max_age }, { mirror: { name: "B" }, max_msgs: 10, max_age: 72e11 })
})

test("bad numbers and durations are reported on their key", () => {
  const { errors } = toConfig({}, { ...toValues({}), num_replicas: "x", max_age: "tomorrow" })
  assert.deepEqual(Object.keys(errors).sort(), ["max_age", "num_replicas"])
})
