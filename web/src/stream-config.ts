// The stream config form is driven by this table: one entry per config key the
// form edits. Keys are the server's own JSON names, so a refusal that names a
// key lands on the field with that key. Any key not listed here (mirror,
// sources, placement…) is carried over untouched when editing.
export type Config = { [key: string]: unknown }

export type Field = {
  key: string
  label: string
  kind: "text" | "list" | "number" | "duration" | "select" | "bool"
  options?: readonly string[]
  help?: string
  // The server refuses to change this on an existing stream.
  fixed?: boolean
  // natscli flag, when the key has one; `edit` is false for flags only `add` takes.
  flag?: { name: string; edit: boolean }
  // Unlimited for a number or duration left empty.
  unlimited?: number
}

export const fields: readonly Field[] = [
  { key: "name", label: "Name", kind: "text", fixed: true, help: "Letters, numbers, - and _. Fixed once created." },
  { key: "description", label: "Description", kind: "text", flag: { name: "description", edit: true } },
  { key: "subjects", label: "Subjects", kind: "list", help: "One per line. Wildcards * and > are allowed.", flag: { name: "subjects", edit: true } },
  { key: "storage", label: "Storage", kind: "select", options: ["file", "memory"], fixed: true, flag: { name: "storage", edit: false } },
  { key: "retention", label: "Retention", kind: "select", options: ["limits", "interest", "workqueue"], fixed: true, flag: { name: "retention", edit: false } },
  { key: "discard", label: "When full, discard", kind: "select", options: ["old", "new"], flag: { name: "discard", edit: true } },
  { key: "num_replicas", label: "Replicas", kind: "number", help: "1, 3 or 5. More than 1 needs a cluster.", flag: { name: "replicas", edit: true } },
  { key: "max_msgs", label: "Max messages", kind: "number", unlimited: -1, help: "Empty is unlimited.", flag: { name: "max-msgs", edit: true } },
  { key: "max_bytes", label: "Max bytes", kind: "number", unlimited: -1, help: "Empty is unlimited.", flag: { name: "max-bytes", edit: true } },
  { key: "max_age", label: "Max age", kind: "duration", unlimited: 0, help: "For example 30s, 15m, 24h or 7d. Empty is forever.", flag: { name: "max-age", edit: true } },
  { key: "max_msg_size", label: "Max message size (bytes)", kind: "number", unlimited: -1, help: "Empty is the server's max_payload.", flag: { name: "max-msg-size", edit: true } },
  { key: "max_msgs_per_subject", label: "Max messages per subject", kind: "number", unlimited: -1, flag: { name: "max-msgs-per-subject", edit: true } },
  { key: "max_consumers", label: "Max consumers", kind: "number", unlimited: -1, flag: { name: "max-consumers", edit: true } },
  { key: "duplicate_window", label: "Duplicate window", kind: "duration", unlimited: 0, help: "How long Nats-Msg-Id repeats are dropped. Empty is the server default.", flag: { name: "dupe-window", edit: true } },
  { key: "allow_direct", label: "Allow direct get", kind: "bool", flag: { name: "allow-direct", edit: true } },
  { key: "allow_rollup_hdrs", label: "Allow roll-ups", kind: "bool", flag: { name: "allow-rollup", edit: true } },
  { key: "deny_delete", label: "Deny message delete", kind: "bool", flag: { name: "deny-delete", edit: true } },
  { key: "deny_purge", label: "Deny purge", kind: "bool", flag: { name: "deny-purge", edit: true } },
]

// natscli adds streams with allow_direct on, so the form does too and the commands match.
export const defaults: Config = { storage: "file", retention: "limits", discard: "old", num_replicas: 1, allow_direct: true }

const units: [string, number][] = [["d", 864e11], ["h", 36e11], ["m", 6e10], ["s", 1e9], ["ms", 1e6]]

// parseDuration turns "1h30m" or "7d" into nanoseconds; undefined when it is not a duration.
export function parseDuration(text: string): number | undefined {
  const t = text.trim()
  if (!/^(\d+(\.\d+)?(ms|s|m|h|d))+$/.test(t)) return undefined
  let total = 0
  for (const [, n, u] of t.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h|d)/g)) total += Number(n) * units.find(([name]) => name === u)![1]
  return Math.round(total)
}

export function formatDuration(ns: number): string {
  let rest = ns
  let out = ""
  for (const [name, size] of units) {
    const n = Math.floor(rest / size)
    if (n > 0) out += `${n}${name}`
    rest -= n * size
  }
  return out
}

export type Values = { [key: string]: string | boolean }

// toValues turns a config into form values. table is the form's field table,
// the stream's unless given.
export function toValues(cfg: Config, table: readonly Field[] = fields): Values {
  const v: Values = {}
  for (const f of table) {
    const x = cfg[f.key]
    if (f.kind === "bool") v[f.key] = x === true
    else if (f.kind === "list") v[f.key] = Array.isArray(x) ? x.join("\n") : ""
    else if (f.kind === "duration") v[f.key] = typeof x === "number" && x > 0 ? formatDuration(x) : ""
    else if (f.kind === "number") v[f.key] = typeof x === "number" && x !== f.unlimited && !(f.unlimited === undefined && x === 0) ? String(x) : ""
    else v[f.key] = typeof x === "string" ? x : ""
  }
  return v
}

// toConfig lays form values over base. A value that cannot be read is reported
// against its own key so the form can show it on that field.
export function toConfig(base: Config, v: Values, table: readonly Field[] = fields): { config: Config; errors: { [key: string]: string } } {
  const config: Config = { ...base }
  const errors: { [key: string]: string } = {}
  for (const f of table) {
    const x = v[f.key]
    if (f.kind === "bool") config[f.key] = x === true
    else if (f.kind === "list") config[f.key] = String(x).split("\n").map((s) => s.trim()).filter(Boolean)
    else if (f.kind === "duration") {
      const ns = String(x).trim() === "" ? f.unlimited : parseDuration(String(x))
      if (ns === undefined) errors[f.key] = "Use a duration like 30s, 15m, 24h or 7d."
      else config[f.key] = ns
    } else if (f.kind === "number") {
      const s = String(x).trim()
      if (s === "") {
        if (f.unlimited === undefined) errors[f.key] = "Enter a whole number."
        else config[f.key] = f.unlimited
      } else if (!/^-?\d+$/.test(s)) errors[f.key] = "Enter a whole number."
      else config[f.key] = Number(s)
    } else config[f.key] = String(x).trim()
  }
  return { config, errors }
}

// shellQuote quotes s for a POSIX shell only when it needs it.
export const shellQuote = (s: string) => (/^[\w.,:/@=-]+$/.test(s) ? s : `'${s.replaceAll("'", "'\\''")}'`)

// cliFor is the `nats` command that makes the same change: the flags that
// differ from `before`. For a new stream `before` is the blank form, for an
// edit it is the stream as it is.
export function cliFor(config: Config, before?: Config): string {
  const edit = before !== undefined
  const base = before ?? toConfig({}, toValues(defaults)).config
  const parts = [edit ? `nats stream edit ${config.name}` : `nats stream add ${config.name || "NAME"}`, ...flagsFor(fields, config, base, edit)]
  return edit ? `${parts.join(" ")} --force` : parts.join(" ")
}

// flagsFor is the natscli flags for the fields of table whose value differs from base.
export function flagsFor(table: readonly Field[], config: Config, base: Config, edit = false): string[] {
  const parts: string[] = []
  for (const f of table) {
    if (!f.flag || (edit && !f.flag.edit) || JSON.stringify(config[f.key]) === JSON.stringify(base[f.key])) continue
    const now = config[f.key]
    const flag = `--${f.flag.name}`
    if (f.kind === "bool") parts.push(now ? flag : `--no-${f.flag.name}`)
    else if (f.kind === "list") parts.push(`${flag} ${shellQuote((now as string[]).join(","))}`)
    else if (f.kind === "duration") parts.push(`${flag} ${now ? formatDuration(now as number) : "''"}`)
    else if (f.key === "retention") parts.push(`${flag} ${now === "workqueue" ? "work" : now}`)
    else parts.push(`${flag} ${shellQuote(String(now))}`)
  }
  return parts
}

export function purgeCli(name: string, p: { subject?: string; keep?: number; sequence?: number }) {
  return [`nats stream purge ${name}`, p.subject && `--subject ${shellQuote(p.subject)}`, p.keep && `--keep ${p.keep}`, p.sequence && `--seq ${p.sequence}`, "--force"].filter(Boolean).join(" ")
}
