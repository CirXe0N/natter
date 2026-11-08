// Recaptures src/assets/screens/*.webp against internal/e2eserver with demo
// order traffic. Needs Go, ImageMagick and web's npm deps with Playwright's
// Chromium. node site/capture.mjs [names...]
import { execFileSync, spawn } from "node:child_process"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const out = fileURLToPath(new URL("src/assets/screens/", import.meta.url))
const only = process.argv.slice(2)
const { chromium } = createRequire(`${root}web/package.json`)("@playwright/test")
// The e2e build reports version "e2e"; show the release a user would have.
const version = process.env.NATTER_VERSION ?? execFileSync("git", ["describe", "--tags", "--abbrev=0", "--match", "v*"], { cwd: root, encoding: "utf8" }).trim()

execFileSync("npm", ["run", "build"], { cwd: `${root}web`, stdio: "inherit" }) // the server embeds web/dist
const server = spawn("go", ["run", "./internal/e2eserver"], { cwd: root, stdio: ["ignore", "pipe", "inherit"], detached: true })
const ready = await new Promise((resolve, reject) => {
  let buf = ""
  server.stdout.on("data", (d) => {
    buf += d
    const m = buf.match(/E2E READY url=(\S+) token=(\S+) monitoring=(\S+)/)
    if (m) resolve({ url: m[1], token: m[2], monitoring: m[3] })
  })
  server.on("exit", (c) => reject(new Error(`e2eserver exited ${c}`)))
})
const stop = () => { try { process.kill(-server.pid, "SIGTERM") } catch {} }
process.on("exit", stop)

const browser = await chromium.launch()
const ctx = await browser.newContext({ baseURL: ready.url, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "dark" })
const page = await ctx.newPage()
await page.goto(`/launch?token=${ready.token}`)
await page.getByRole("navigation", { name: "Screens" }).waitFor()
const api = ctx.request
await api.put("/api/contexts/active", { data: { source: "cli", name: "app" } })
await api.put("/api/contexts/cli/app/settings", { data: { monitoringUrl: ready.monitoring } })

// Demo orders.
const customers = ["m.okafor", "c.dubois", "j.tanaka", "t.berg", "a.kowalski", "lena.vos", "priya.n", "sam.rivera"]
const skus = ["HDMI-2M", "WEBCAM-1080", "MS-ERGO-01", "USB-C-HUB7", "MON-27-4K", "DESK-MAT-XL"]
const regions = ["eu", "us", "ap"]
let order = 48211
let n = 0
const pick = (a) => a[Math.floor(Math.random() * a.length)]
function demo() {
  const id = `ord_${order - 6 + Math.floor(Math.random() * 7)}`
  const region = pick(regions)
  const ts = new Date().toISOString()
  const kind = n++ % 4
  if (kind === 0) {
    const qty = 1 + Math.floor(Math.random() * 3)
    const price = Math.round(Math.random() * 30000) / 100
    return { subject: `orders.${region}.new`, payload: { id: `ord_${order++}`, customer: pick(customers), total: Math.round(qty * price * 100) / 100, currency: "EUR", items: [{ sku: pick(skus), qty, price }], ts } }
  }
  if (kind === 1) return { subject: `orders.${region}.paid`, payload: { id, provider: pick(["adyen", "stripe"]), method: pick(["card", "ideal", "paypal"]), ts } }
  if (kind === 2) return { subject: `orders.${region}.shipped`, payload: { id, carrier: pick(["postnl", "dhl", "ups"]), tracking: `JV${Math.floor(1e9 + Math.random() * 9e9)}`, ts } }
  return { subject: `orders.${region}.delivered`, payload: { id, ts } }
}
async function send() {
  const { subject, payload } = demo()
  const headers = [["Content-Type", "application/json"], ["Nats-Msg-Id", `${payload.id}-${n}`], ["X-Region", subject.split(".")[1]]]
  await api.post("/api/send", { data: { mode: "pub", subject, headers, payload: JSON.stringify(payload), timeoutMs: 0, count: 1 } })
}
for (let i = 0; i < 67; i++) await send()

for (const e of await (await api.get("/api/examples")).json()) await api.delete(`/api/examples/${e.id}`)
await api.post("/api/examples", {
  data: {
    context: "app", name: "New order", folder: "orders", mode: "pub", subject: "orders.eu.new",
    headers: [["Content-Type", "application/json"]],
    payload: '{\n  "order": "{{ID}}",\n  "seq": {{Count}},\n  "placed_at": "{{TimeStamp}}",\n  "items": [{ "sku": "NTR-001", "qty": 2 }]\n}',
  },
})

// Live traffic, about 8 a second, for the rates and the tail.
let live = true
;(async () => { while (live) { await send().catch(() => {}); await new Promise((r) => setTimeout(r, 120)) } })()

const settle = (ms = 1500) => page.waitForTimeout(ms)
async function shot(name, go, height) {
  if (only.length && !only.includes(name)) return
  await go()
  await page.mouse.move(0, 899)
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
  await page.evaluate((v) => { for (const el of document.querySelectorAll("*")) if (el.children.length === 0 && el.textContent === "Natter e2e") el.textContent = `Natter ${v}` }, version)
  const png = await page.screenshot({ clip: height ? { x: 0, y: 0, width: 1440, height } : undefined })
  execFileSync("magick", ["png:-", "-quality", "82", "-define", "webp:method=6", `${out}${name}.webp`], { input: png })
  console.log("shot", name)
}

await shot("overview", async () => { await page.goto("/overview"); await settle(7000) })
await shot("streams", async () => { await page.goto("/streams"); await settle() })
await shot("messages", async () => {
  await page.goto("/messages?stream=ORDERS")
  await settle(2500)
  // Past the three bare messages the e2e server seeds.
  await page.getByLabel("Sequence", { exact: true }).fill("4")
  await page.getByRole("button", { name: "Jump to sequence" }).click()
  await settle()
})
await shot("message", async () => {
  await page.goto("/messages?stream=ORDERS")
  await settle(2000)
  await page.getByRole("row").filter({ hasText: "#4" }).first().click()
  await settle()
  await page.getByRole("dialog").getByRole("button", { name: "JSON" }).click()
  await settle()
})
await shot("consumers", async () => { await page.goto("/consumers"); await settle(2500) })
await shot("consumers-list", async () => { await page.goto("/consumers"); await settle(2500) }, 500)
await shot("consumer", async () => { await page.goto("/consumers/ORDERS/billing"); await settle(2500) })
await shot("publish", async () => {
  await page.goto("/publish")
  await settle()
  await page.getByRole("button", { name: /^Examples/ }).click()
  await page.getByRole("dialog", { name: "Example messages" }).getByRole("button", { name: "Load New order" }).click()
  await settle(500)
  await page.getByRole("button", { name: "Publish message" }).click()
  await settle()
})
await shot("tail", async () => { await page.goto(`/tail?subject=${encodeURIComponent("orders.>")}`); await settle(5000) })
await shot("contexts", async () => { await page.goto("/contexts"); await settle() })

live = false
await browser.close()
stop()
process.exit(0)
