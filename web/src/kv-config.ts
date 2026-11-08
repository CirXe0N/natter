// The bucket form is driven by this table, read by stream-config.ts's
// helpers. Keys are nats.go's KeyValueConfig JSON names, so a refusal that
// names a key lands on its field. fixed marks what the server refuses to
// change on an existing bucket.
import { toConfig, type Config, type Field, type Values } from "./stream-config.ts"

export const bucketFields: readonly Field[] = [
  { key: "bucket", label: "Name", kind: "text", fixed: true, help: "Letters, numbers, - and _. Fixed once created." },
  { key: "description", label: "Description", kind: "text" },
  { key: "history", label: "History", kind: "number", help: "Revisions kept per key, 1 to 64." },
  { key: "ttl", label: "TTL", kind: "duration", unlimited: 0, help: "How long a value is kept. For example 30s, 15m, 24h or 7d. Empty is forever." },
  { key: "max_value_size", label: "Max value size (bytes)", kind: "number", unlimited: -1, help: "Empty is the server's max_payload." },
  { key: "max_bytes", label: "Max bucket size (bytes)", kind: "number", unlimited: -1, help: "Empty is unlimited." },
  { key: "storage", label: "Storage", kind: "select", options: ["file", "memory"], fixed: true },
  { key: "num_replicas", label: "Replicas", kind: "number", help: "1, 3 or 5. More than 1 needs a cluster." },
  { key: "compression", label: "Compression", kind: "bool", help: "Compress the stored values with S2." },
]

export const bucketDefaults: Config = { history: 1, storage: "file", num_replicas: 1 }

// toBucket lays the form over base, the bucket's config when editing, and
// checks the name and history as nats.go would.
export function toBucket(v: Values, base: Config = {}): { config: Config; errors: { [key: string]: string } } {
  const r = toConfig(base, v, bucketFields)
  const name = String(r.config.bucket)
  if (!name) r.errors.bucket = "Enter a name."
  else if (!/^[a-zA-Z0-9_-]+$/.test(name)) r.errors.bucket = "Use only letters, numbers, - and _."
  const history = r.config.history as number
  if (!r.errors.history && !(history >= 1 && history <= 64)) r.errors.history = "Keep 1 to 64 revisions."
  return r
}
