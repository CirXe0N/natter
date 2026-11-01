// What the payload viewer draws: a decoded payload, and the rows of its
// virtualised text, JSON and hex views. parse runs in the query function, so
// decoding and JSON.parse never happen during render.
export const PREVIEW = 64 * 1024
export const WRAP = 100 // characters per text row; long lines wrap so every row has one height

export type Payload = {
  bytes: Uint8Array
  whole: boolean
  binary: boolean
  rows: string[] // the text view's rows
  json?: { value: unknown } // only for a whole payload that parses
}

// Control characters other than tab, CR and LF mean binary, as the server's classify does.
const control = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/

export function parse(bytes: Uint8Array, whole: boolean): Payload {
  let text: string
  let binary: boolean
  try {
    // stream: a chunk may end inside a character, which is not an error
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: !whole })
    binary = control.test(text)
  } catch {
    text = new TextDecoder().decode(bytes)
    binary = true
  }
  let json: Payload["json"]
  if (whole && !binary && text.trim())
    try {
      json = { value: JSON.parse(text) }
    } catch {
      // not JSON
    }
  const rows: string[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line) rows.push("")
    for (let i = 0; i < line.length; i += WRAP) rows.push(line.slice(i, i + WRAP))
  }
  return { bytes, whole, binary, rows, json }
}

// hexRow is row r of the hex view: offset, 16 bytes, and their printable ASCII.
export function hexRow(b: Uint8Array, r: number): [string, string, string] {
  let hex = ""
  let ascii = ""
  b.subarray(r * 16, r * 16 + 16).forEach((x, i) => {
    hex += x.toString(16).padStart(2, "0") + (i === 7 ? "  " : " ")
    ascii += x >= 0x20 && x < 0x7f ? String.fromCharCode(x) : "."
  })
  return [(r * 16).toString(16).padStart(8, "0"), hex.trimEnd(), ascii]
}

// open is set only on an object or array with children.
export type JsonRow = { depth: number; key?: string; path: string; value: unknown; open?: boolean }

// jsonRows lists the nodes depth first, skipping the children of closed paths.
// It walks with a stack, so deep nesting cannot overflow the call stack.
export function jsonRows(value: unknown, closed: ReadonlySet<string>): JsonRow[] {
  const rows: JsonRow[] = []
  const stack: [unknown, number, string, string?][] = [[value, 0, "$"]]
  while (stack.length) {
    const [v, depth, path, key] = stack.pop()!
    const entries = v !== null && typeof v === "object" ? Object.entries(v) : []
    const open = entries.length ? !closed.has(path) : undefined
    rows.push({ depth, key, path, value: v, open })
    if (open) for (let i = entries.length - 1; i >= 0; i--) stack.push([entries[i][1], depth + 1, `${path}\u0000${entries[i][0]}`, entries[i][0]])
  }
  return rows
}
