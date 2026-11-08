// Fails on styles that break the design system's two promises:
// the :focus-visible outline in index.css always shows, and colours come from tokens.
import { readFileSync, readdirSync } from "node:fs"

const rules = [
  [/\boutline-(none|hidden|0)\b|outline:\s*(none|0)\b/, "removes the focus outline"],
  [/\b(bg|text|border|ring|shadow|outline|fill|stroke|from|via|to)-(white|black)\b/, "uses a dark-only white/black literal instead of a token"],
]
// Files that may drop the outline because something else shows focus.
const outlineShownElsewhere = new Set([
  "components/filter-field.tsx", // its box border turns full primary on focus
])
let failed = false
for (const f of readdirSync("src", { recursive: true }).filter((f) => /\.(tsx?|css)$/.test(f))) {
  const src = readFileSync(`src/${f}`, "utf8")
  for (const [re, why] of rules) {
    if (re === rules[0][0] && outlineShownElsewhere.has(f)) continue
    const m = src.match(re)
    if (m) {
      console.error(`src/${f}: "${m[0]}" ${why}`)
      failed = true
    }
  }
}
process.exit(failed ? 1 : 0)
