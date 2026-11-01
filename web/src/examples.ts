import type { Example } from "./gen/api.ts"

// The Examples among ids that would land on a name already taken on the target
// Context, which is what the server asks a choice for.
export function conflicts(all: Example[], ids: string[], target: string): Example[] {
  return all.filter((e) => ids.includes(e.id) && all.some((o) => o.context === target && o.folder === e.folder && o.name === e.name))
}
