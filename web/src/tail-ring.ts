// The Live tail's rows in the tab: oldest first, at most CAP entries. Gaps
// and disconnects become entries of their own, where they happened.
import type { Tail, TailRow } from "./gen/api.ts"

export const CAP = 10_000

// at is when a row reached the tab, in ms, for its highlight.
export type Entry = { key: string; row: TailRow; at: number } | { key: string; note: string }

// seen: a frame has arrived. epoch counts tail restarts, whose row IDs start over.
export type TailRing = { entries: Entry[]; seen: boolean; last?: number; epoch: number; disconnects: number }

export const emptyRing: TailRing = { entries: [], seen: false, epoch: 0, disconnects: 0 }

// add appends a frame. Row IDs count up by one, so a jump is a gap: the
// socket dropped frames (behind, after a gap marker) or the tab was paused.
export function add(r: TailRing, f: Tail, behind: boolean, now = 0): TailRing {
  const notes: string[] = []
  const first = f.rows[0]
  let epoch = r.epoch
  if (first && r.last !== undefined) {
    const missed = first.id - r.last - 1
    const why = behind ? "this tab fell behind" : "paused"
    if (missed > 0) notes.push(`${missed.toLocaleString("en-US")} ${missed === 1 ? "message" : "messages"} not shown: ${why}.`)
    else if (missed < 0) {
      epoch++
      notes.push(`The tail restarted while ${why}. Messages in between were not kept.`)
    }
  }
  if (r.seen && f.disconnects > r.disconnects)
    notes.push(`The server closed the tail's connection (${f.disconnect ?? "no reason given"}). It may have cut the tail off as a slow consumer. How many messages were missed is not known.`)
  const next = { ...r, seen: true, epoch, disconnects: f.disconnects }
  if (!notes.length && !f.rows.length) return next
  const entries = [
    ...r.entries,
    ...notes.map((note, i) => ({ key: `note-${epoch}-${first?.id ?? r.last}-${f.disconnects}-${i}`, note })),
    ...f.rows.map((row) => ({ key: `${epoch}-${row.id}`, row, at: now })),
  ]
  return { ...next, entries: entries.length > CAP ? entries.slice(-CAP) : entries, last: f.rows.at(-1)?.id ?? r.last }
}
