import assert from "node:assert/strict"
import { test } from "node:test"

import { hexRow, jsonRows, parse, WRAP } from "./payload.ts"

const enc = (s: string) => new TextEncoder().encode(s)

test("a whole JSON payload parses; a truncated chunk of it never does", () => {
  assert.deepEqual(parse(enc('{"a":[1,2]}'), true).json, { value: { a: [1, 2] } })
  assert.equal(parse(enc('{"a":[1,2]}'), false).json, undefined)
  assert.equal(parse(enc("not json"), true).json, undefined)
  assert.equal(parse(enc(""), true).json, undefined)
})

test("control bytes or invalid UTF-8 make a payload binary; a chunk cut inside a character does not", () => {
  assert.equal(parse(new Uint8Array([0, 1, 2]), true).binary, true)
  assert.equal(parse(new Uint8Array([0xff, 0xfe]), true).binary, true)
  assert.equal(parse(enc("tab\tand\r\nnewline"), true).binary, false)
  const cut = enc("é").subarray(0, 1)
  assert.equal(parse(cut, false).binary, false)
  assert.equal(parse(cut, true).binary, true)
})

test("text rows split lines and wrap long ones", () => {
  const p = parse(enc(`a\n\n${"x".repeat(WRAP + 1)}`), true)
  assert.deepEqual(p.rows, ["a", "", "x".repeat(WRAP), "x"])
})

test("a hex row shows the offset, 16 bytes in two halves and printable ASCII", () => {
  const b = new Uint8Array(20).map((_, i) => i + 60)
  assert.deepEqual(hexRow(b, 0), ["00000000", "3c 3d 3e 3f 40 41 42 43  44 45 46 47 48 49 4a 4b", "<=>?@ABCDEFGHIJK"])
  assert.deepEqual(hexRow(b, 1), ["00000010", "4c 4d 4e 4f", "LMNO"])
  assert.equal(hexRow(new Uint8Array([0, 127, 128]), 0)[2], "...")
})

test("JSON rows list every node depth first, and a closed node hides its children", () => {
  const v = { a: [1, { b: null }], c: "s", d: {} }
  const shape = (rows: ReturnType<typeof jsonRows>) => rows.map((r) => `${" ".repeat(r.depth)}${r.key ?? "$"}${r.open === undefined ? "" : r.open ? "-" : "+"}`)
  assert.deepEqual(shape(jsonRows(v, new Set())), ["$-", " a-", "  0", "  1-", "   b", " c", " d"])
  const a = jsonRows(v, new Set()).find((r) => r.key === "a")!.path
  assert.deepEqual(shape(jsonRows(v, new Set([a]))), ["$-", " a+", " c", " d"])
})
