// The consumer config form is driven by this table, like stream-config.ts:
// one entry per config key, named as the server's JSON names it, so a refusal
// that names a key lands on its field. Keys the table does not list
// (pause_until…) are carried over untouched when editing.
import { formatDuration, parseDuration } from "./stream-config.ts"

export type Config = { [key: string]: unknown }
export type Values = { [key: string]: string | boolean }

export type Section = "consumer" | "delivery" | "ack" | "pull" | "push" | "storage"

export type Field = {
  key: string
  label: string
  section: Section
  kind: "text" | "list" | "map" | "number" | "duration" | "durations" | "datetime" | "select" | "bool"
  options?: readonly { value: string; label: string }[]
  help?: string
  placeholder?: string
  // The server refuses to change it on an existing consumer.
  fixed?: boolean
  // Not a config key: the form derives durable_name and deliver_subject from it.
  virtual?: boolean
  required?: boolean
  // Shown only when this holds. A hidden field is left out of the config.
  when?: (v: Values) => boolean
  // What an empty number or duration sends; without it the key is left out and the server picks.
  empty?: number
}

const pull = (v: Values) => v.mode === "pull"
const push = (v: Values) => v.mode === "push"

export const fields: readonly Field[] = [
  { key: "name", label: "Name", section: "consumer", kind: "text", fixed: true, required: true, placeholder: "billing", help: "Letters, numbers, - and _." },
  { key: "durable", label: "Durable", section: "consumer", kind: "bool", virtual: true, fixed: true, help: "Stays until deleted. An ephemeral consumer is removed once idle for its inactive threshold." },
  { key: "description", label: "Description", section: "consumer", kind: "text" },
  { key: "metadata", label: "Metadata", section: "consumer", kind: "map", placeholder: "team=billing", help: "One key=value per line." },

  { key: "mode", label: "Type", section: "delivery", kind: "select", virtual: true, fixed: true, options: [{ value: "pull", label: "Pull" }, { value: "push", label: "Push" }] },
  { key: "filter_subjects", label: "Filter subjects", section: "delivery", kind: "list", placeholder: "orders.eu.>", help: "One per line. Empty delivers every subject in the stream." },
  {
    key: "deliver_policy",
    label: "Start from",
    section: "delivery",
    kind: "select",
    fixed: true,
    options: [
      { value: "all", label: "First message" },
      { value: "new", label: "New messages only" },
      { value: "last", label: "Last message" },
      { value: "last_per_subject", label: "Last message per subject" },
      { value: "by_start_sequence", label: "A sequence" },
      { value: "by_start_time", label: "A time" },
    ],
  },
  { key: "opt_start_seq", label: "Start sequence", section: "delivery", kind: "number", fixed: true, required: true, when: (v) => v.deliver_policy === "by_start_sequence" },
  { key: "opt_start_time", label: "Start time", section: "delivery", kind: "datetime", fixed: true, required: true, when: (v) => v.deliver_policy === "by_start_time" },
  { key: "replay_policy", label: "Replay", section: "delivery", kind: "select", fixed: true, options: [{ value: "instant", label: "Instant" }, { value: "original", label: "Original timing" }] },
  { key: "headers_only", label: "Headers only", section: "delivery", kind: "bool", help: "Deliver headers and the payload size, not the payload." },
  { key: "sample_freq", label: "Sample frequency", section: "delivery", kind: "text", placeholder: "100%", help: "Share of acks published as advisories for latency monitoring." },

  { key: "ack_policy", label: "Ack policy", section: "ack", kind: "select", fixed: true, options: [{ value: "explicit", label: "Explicit" }, { value: "all", label: "All" }, { value: "none", label: "None" }] },
  { key: "ack_wait", label: "Ack wait", section: "ack", kind: "duration", placeholder: "30s", help: "Redeliver when no ack comes back in this time. Empty is 30s." },
  { key: "max_deliver", label: "Max deliveries", section: "ack", kind: "number", empty: -1, help: "Empty is unlimited." },
  { key: "backoff", label: "Backoff", section: "ack", kind: "durations", placeholder: "1s, 5s, 30s", help: "Redelivery delays, one per attempt; replaces Ack wait for redeliveries." },
  { key: "max_ack_pending", label: "Max ack pending", section: "ack", kind: "number", help: "Unacked messages before delivery stops. Empty is the server default (1,000); -1 is unlimited." },

  { key: "max_waiting", label: "Max waiting pulls", section: "pull", kind: "number", fixed: true, when: pull, help: "Empty is the server default (512)." },
  { key: "max_batch", label: "Max batch", section: "pull", kind: "number", when: pull, help: "Largest batch a pull may ask for. Empty is unlimited." },
  { key: "max_expires", label: "Max expires", section: "pull", kind: "duration", when: pull, help: "Longest a pull may wait. Empty is unlimited." },
  { key: "max_bytes", label: "Max bytes per pull", section: "pull", kind: "number", when: pull, help: "Empty is unlimited." },
  {
    key: "priority_policy",
    label: "Priority groups",
    section: "pull",
    kind: "select",
    when: pull,
    options: [
      { value: "none", label: "None" },
      { value: "overflow", label: "Overflow" },
      { value: "pinned_client", label: "Pinned client" },
      { value: "prioritized", label: "Prioritized" },
    ],
  },
  { key: "priority_groups", label: "Group names", section: "pull", kind: "list", required: true, when: (v) => pull(v) && v.priority_policy !== "none", help: "One per line." },
  { key: "priority_timeout", label: "Pinned TTL", section: "pull", kind: "duration", when: (v) => pull(v) && v.priority_policy === "pinned_client", help: "How long a pinned client may go without pulling." },

  { key: "deliver_subject", label: "Deliver subject", section: "push", kind: "text", required: true, when: push, placeholder: "billing.deliver" },
  { key: "deliver_group", label: "Deliver group", section: "push", kind: "text", when: push, help: "Queue group that shares the messages." },
  { key: "idle_heartbeat", label: "Idle heartbeat", section: "push", kind: "duration", fixed: true, when: push, help: "Empty sends none." },
  { key: "flow_control", label: "Flow control", section: "push", kind: "bool", fixed: true, when: push, help: "Lets slow subscribers push back. Needs an idle heartbeat." },
  { key: "rate_limit_bps", label: "Rate limit (bits/s)", section: "push", kind: "number", when: push, help: "Empty is unlimited." },

  { key: "num_replicas", label: "Replicas", section: "storage", kind: "number", empty: 0, help: "Empty inherits the stream's." },
  { key: "inactive_threshold", label: "Inactive threshold", section: "storage", kind: "duration", help: "Remove the consumer after this long without activity. Empty: never for durable, 5s for ephemeral." },
  { key: "mem_storage", label: "Memory storage", section: "storage", kind: "bool", fixed: true, help: "Keep its state in memory, not on disk." },
]

// natscli's `--defaults`: durable, pull, explicit ack, from the first message.
export const defaults: Config = { durable_name: "", ack_policy: "explicit", deliver_policy: "all", replay_policy: "instant" }

const pad = (n: number) => String(n).padStart(2, "0")
// An ISO time as a datetime-local value, in local time.
const toLocal = (iso: string) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

// toValues turns a config into form values. A new consumer passes `defaults`.
export function toValues(cfg: Config): Values {
  const v: Values = {}
  for (const f of fields) {
    const x = cfg[f.key]
    if (f.key === "durable") v.durable = typeof cfg.durable_name === "string"
    else if (f.key === "mode") v.mode = cfg.deliver_subject ? "push" : "pull"
    else if (f.key === "filter_subjects") v[f.key] = [cfg.filter_subject, ...(Array.isArray(cfg.filter_subjects) ? cfg.filter_subjects : [])].filter(Boolean).join("\n")
    else if (f.kind === "bool") v[f.key] = x === true
    else if (f.kind === "list") v[f.key] = Array.isArray(x) ? x.join("\n") : ""
    // The server writes the _nats.* keys itself (API level, version) and rewrites them on every update.
    else if (f.kind === "map") v[f.key] = x && typeof x === "object" ? Object.entries(x).filter(([k]) => !k.startsWith("_nats.")).map(([k, s]) => `${k}=${s}`).join("\n") : ""
    else if (f.kind === "duration") v[f.key] = typeof x === "number" && x > 0 ? formatDuration(x) : ""
    else if (f.kind === "durations") v[f.key] = Array.isArray(x) ? x.map((n) => formatDuration(n as number)).join(", ") : ""
    else if (f.kind === "datetime") v[f.key] = typeof x === "string" && !x.startsWith("0001") ? toLocal(x) : ""
    else if (f.kind === "number") v[f.key] = typeof x === "number" && x !== (f.empty ?? 0) ? String(x) : ""
    else if (f.kind === "select") v[f.key] = typeof x === "string" && x ? x : f.options![0].value
    else v[f.key] = typeof x === "string" ? x : ""
  }
  return v
}

export const visible = (f: Field, v: Values) => !f.when || f.when(v)

// toConfig lays form values over base. A value that cannot be read is reported
// against its own key, so the form shows it on that field.
export function toConfig(base: Config, v: Values): { config: Config; errors: { [key: string]: string } } {
  const config: Config = { ...base }
  const errors: { [key: string]: string } = {}
  delete config.filter_subject // filter_subjects says it, one subject or many
  for (const f of fields) {
    if (f.virtual) continue
    if (!visible(f, v)) {
      delete config[f.key]
      continue
    }
    const x = v[f.key]
    const s = typeof x === "string" ? x.trim() : ""
    const set = (value: unknown) => (value === undefined ? delete config[f.key] : (config[f.key] = value))
    if (f.required && f.kind !== "bool" && s === "") {
      errors[f.key] = f.key === "deliver_subject" ? "A push consumer needs a deliver subject." : `Enter ${f.label.toLowerCase()}.`
      continue
    }
    switch (f.kind) {
      case "bool":
        set(x === true ? true : undefined)
        break
      case "list": {
        const list = s.split("\n").map((l) => l.trim()).filter(Boolean)
        set(list.length ? list : undefined)
        break
      }
      case "map": {
        const m: { [k: string]: string } = {}
        for (const line of s.split("\n").map((l) => l.trim()).filter(Boolean)) {
          const i = line.indexOf("=")
          if (i < 1) errors[f.key] = `"${line}" is not key=value.`
          else m[line.slice(0, i).trim()] = line.slice(i + 1).trim()
        }
        set(Object.keys(m).length ? m : undefined)
        break
      }
      case "duration": {
        const ns = s === "" ? f.empty : parseDuration(s)
        if (s !== "" && ns === undefined) errors[f.key] = "Use a duration like 500ms, 30s, 15m or 2h."
        else set(ns)
        break
      }
      case "durations": {
        const parts = s.split(/[\s,]+/).filter(Boolean)
        const ns = parts.map(parseDuration)
        if (ns.some((n) => n === undefined)) errors[f.key] = "Use durations like 1s, 5s, 30s."
        else set(ns.length ? ns : undefined)
        break
      }
      case "datetime": {
        const t = new Date(s)
        if (Number.isNaN(t.getTime())) errors[f.key] = "Pick a date and time."
        else set(t.toISOString())
        break
      }
      case "number":
        if (s === "") set(f.empty)
        else if (!/^-?\d+$/.test(s)) errors[f.key] = "Enter a whole number."
        else set(Number(s))
        break
      case "select":
        set(f.key === "priority_policy" && x === "none" ? undefined : x)
        break
      default:
        set(s || undefined)
    }
  }
  const name = String(v.name ?? "").trim()
  config.name = name
  if (v.durable) config.durable_name = name
  else delete config.durable_name
  return { config, errors }
}
