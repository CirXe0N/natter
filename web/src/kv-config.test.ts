import assert from "node:assert/strict"
import { test } from "node:test"

import { bucketDefaults, bucketFields, toBucket } from "./kv-config.ts"
import { toValues } from "./stream-config.ts"

const blank = () => toValues(bucketDefaults, bucketFields)

test("a new bucket starts with one revision per key, file storage and one replica", () => {
  const { config, errors } = toBucket({ ...blank(), bucket: "sessions" })
  assert.deepEqual(errors, {})
  assert.deepEqual(config, { bucket: "sessions", description: "", history: 1, ttl: 0, max_value_size: -1, max_bytes: -1, storage: "file", num_replicas: 1, compression: false })
})

test("an edit lays the form over the bucket's config, keeping keys the form does not show", () => {
  // As GET /api/kv/{bucket} sends it: no limit is -1, and file storage is left out.
  const current = { bucket: "sessions", history: 5, ttl: 36e11, max_value_size: -1, max_bytes: -1, num_replicas: 1, metadata: { team: "web" } }
  const base = { ...bucketDefaults, ...current }
  const v = toValues(base, bucketFields)
  assert.deepEqual([v.max_value_size, v.max_bytes, v.ttl, v.storage], ["", "", "1h", "file"])
  const { config, errors } = toBucket({ ...v, history: "7" }, base)
  assert.deepEqual(errors, {})
  assert.deepEqual([config.history, config.metadata, config.max_bytes], [7, { team: "web" }, -1])
})

test("the name must be letters, numbers, - and _, as NATS requires", () => {
  assert.equal(toBucket(blank()).errors.bucket, "Enter a name.")
  assert.equal(toBucket({ ...blank(), bucket: "app.config" }).errors.bucket, "Use only letters, numbers, - and _.")
  assert.equal(toBucket({ ...blank(), bucket: "app_config-2" }).errors.bucket, undefined)
})

test("history keeps 1 to 64 revisions", () => {
  assert.equal(toBucket({ ...blank(), bucket: "b", history: "0" }).errors.history, "Keep 1 to 64 revisions.")
  assert.equal(toBucket({ ...blank(), bucket: "b", history: "65" }).errors.history, "Keep 1 to 64 revisions.")
  assert.equal(toBucket({ ...blank(), bucket: "b", history: "64" }).errors.history, undefined)
  assert.equal(toBucket({ ...blank(), bucket: "b", history: "x" }).errors.history, "Enter a whole number.")
})

test("filled fields become the bucket config, with sizes and TTL in their units", () => {
  const { config, errors } = toBucket({ ...blank(), bucket: "sessions", description: "web sessions", history: "5", ttl: "1h", max_value_size: "1024", max_bytes: "1048576", storage: "memory", num_replicas: "3", compression: true })
  assert.deepEqual(errors, {})
  assert.deepEqual(config, { bucket: "sessions", description: "web sessions", history: 5, ttl: 36e11, max_value_size: 1024, max_bytes: 1048576, storage: "memory", num_replicas: 3, compression: true })
})
