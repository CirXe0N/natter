import assert from "node:assert/strict"
import { test } from "node:test"

import { cliFor, defaults, goDuration, toConfig, toValues } from "./consumer-config.ts"

test("a new consumer is durable, pull, explicit ack, from the first message", () => {
  const { config, errors } = toConfig(defaults, { ...toValues(defaults), name: "billing" })
  assert.deepEqual(errors, {})
  assert.deepEqual(config, { name: "billing", durable_name: "billing", ack_policy: "explicit", deliver_policy: "all", replay_policy: "instant", max_deliver: -1, num_replicas: 0 })
})

test("an edit keeps keys the form does not show, and one filter goes in filter_subjects", () => {
  const base = { name: "b", durable_name: "b", ack_policy: "explicit", deliver_policy: "all", replay_policy: "instant", filter_subject: "orders.>", pause_until: "2030-01-01T00:00:00Z", max_ack_pending: 1000, ack_wait: 30e9, metadata: { team: "ops", "_nats.ver": "2.12.0" } }
  const v = toValues(base)
  assert.equal(v.filter_subjects, "orders.>")
  assert.equal(v.metadata, "team=ops") // the server's own keys stay out of the form
  assert.equal(v.ack_wait, "30s")
  const { config, errors } = toConfig(base, { ...v, max_deliver: "5", backoff: "1s, 5s" })
  assert.deepEqual(errors, {})
  assert.equal(config.filter_subject, undefined)
  assert.deepEqual(config.filter_subjects, ["orders.>"])
  assert.equal(config.pause_until, "2030-01-01T00:00:00Z")
  assert.deepEqual([config.max_deliver, config.backoff, config.max_ack_pending], [5, [1e9, 5e9], 1000])
})

test("switching to push drops the pull fields and needs a deliver subject", () => {
  const base = { ...defaults, name: "p", max_waiting: 512, max_batch: 10 }
  const v = { ...toValues(base), name: "p", mode: "push" }
  assert.deepEqual(toConfig(base, v).errors, { deliver_subject: "A push consumer needs a deliver subject." })
  const { config } = toConfig(base, { ...v, deliver_subject: "p.out", idle_heartbeat: "5s", flow_control: true })
  assert.deepEqual([config.max_waiting, config.max_batch, config.deliver_subject, config.idle_heartbeat, config.flow_control], [undefined, undefined, "p.out", 5e9, true])
})

test("bad values are reported on their key", () => {
  const { errors } = toConfig(defaults, { ...toValues(defaults), name: "x", ack_wait: "soon", metadata: "team", backoff: "1s, later", max_deliver: "many" })
  assert.deepEqual(Object.keys(errors).sort(), ["ack_wait", "backoff", "max_deliver", "metadata"])
})

test("an ephemeral consumer has no durable_name, and a start sequence is required", () => {
  const v = { ...toValues(defaults), name: "e", durable: false, deliver_policy: "by_start_sequence" }
  assert.deepEqual(toConfig(defaults, v).errors, { opt_start_seq: "Enter start sequence." })
  const { config } = toConfig(defaults, { ...v, opt_start_seq: "42" })
  assert.equal(config.durable_name, undefined)
  assert.equal(config.opt_start_seq, 42)
})

test("the CLI command", () => {
  const { config } = toConfig(defaults, { ...toValues(defaults), name: "billing", filter_subjects: "orders.eu.>\norders.us.>", ack_wait: "2d", max_deliver: "5", metadata: "team=ops" })
  assert.equal(cliFor("ORDERS", config), "nats consumer add ORDERS billing --pull --ack explicit --replay instant --deliver all --metadata team=ops --filter 'orders.eu.>' --filter 'orders.us.>' --wait 48h --max-deliver 5 --defaults")
  assert.equal(cliFor("ORDERS", { ...config, max_deliver: 9, description: "new" }, config), "nats consumer edit ORDERS billing --description new --max-deliver 9 --force")
  const fromServer = { ...config, metadata: { team: "ops", "_nats.ver": "2.12.0" } }
  assert.equal(cliFor("ORDERS", { ...config, max_deliver: 9 }, fromServer), "nats consumer edit ORDERS billing --max-deliver 9 --force")
  assert.equal(goDuration(90e9), "1m30s")
})
