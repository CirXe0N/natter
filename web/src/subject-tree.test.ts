import assert from "node:assert/strict"
import { test } from "node:test"

import { subjectTree } from "./subject-tree.ts"

test("groups subjects by token and sums counts up the tree", () => {
  const t = subjectTree({ "orders.us.paid": 1, "orders.eu.new": 2, "orders.eu": 4, audit: 3 })
  assert.deepEqual(
    t.map((n) => [n.subject, n.total, n.own]),
    [["audit", 3, 3], ["orders", 7, 0]],
  )
  const eu = t[1].children[0]
  assert.deepEqual([eu.token, eu.subject, eu.total, eu.own], ["eu", "orders.eu", 6, 4])
  assert.deepEqual(eu.children.map((n) => n.subject), ["orders.eu.new"])
  assert.deepEqual(t[1].children.map((n) => n.token), ["eu", "us"])
})

test("an empty map gives an empty tree", () => {
  assert.deepEqual(subjectTree({}), [])
})
