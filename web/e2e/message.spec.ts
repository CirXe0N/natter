import { statSync } from "node:fs"
import { expect, test, type Page } from "@playwright/test"

// BLOBS (internal/e2eserver): 1 is 4 MB of JSON, 2 is 4 MB of binary, 3-12 are small.
const activate = (page: Page) => page.request.put("/api/contexts/active", { data: { source: "cli", name: "app" } })
const rows = (page: Page) => page.getByRole("rowgroup", { name: "Message rows" })
const openRow = (page: Page, seq: number) => rows(page).getByRole("cell", { name: `#${seq}`, exact: true }).click()

test("opening a 4 MB message shows 64 KB first, then the whole payload as a JSON tree and as hex", async ({ page }) => {
  await activate(page)
  await page.goto("/streams/BLOBS/messages")
  // Long tasks over 50 ms, so a frozen page shows up as a number.
  await page.evaluate(() => {
    const w = window as unknown as { longest: number }
    w.longest = 0
    new PerformanceObserver((l) => l.getEntries().forEach((e) => (w.longest = Math.max(w.longest, e.duration)))).observe({ type: "longtask" })
  })

  const preview = page.waitForResponse((r) => r.url().endsWith("/api/streams/BLOBS/messages/1/payload"))
  await openRow(page, 1)
  const drawer = page.getByRole("dialog", { name: "Message #1" })
  await expect(drawer.getByRole("definition")).toHaveText("application/json")
  const r = await preview
  expect(r.status()).toBe(206)
  expect(r.request().headers()["range"]).toBe("bytes=0-65535")
  expect((await r.body()).length).toBe(65536)
  const size = Number((await r.headerValue("content-range"))!.split("/")[1])

  await expect(drawer.getByText("Showing the first 64.0 KiB of 4.0 MiB")).toBeVisible()
  await expect(drawer.getByRole("list", { name: "Payload as text" })).toContainText('{"items":[{"id":0,"name":"item-0"')
  await expect(drawer.getByRole("button", { name: "JSON" })).toBeDisabled()
  await expect(drawer.getByRole("button", { name: "Text" })).toHaveAttribute("aria-pressed", "true")
  await expect(drawer.getByRole("button", { name: "Copy as CLI: nats stream get BLOBS 1" })).toBeVisible()

  // The whole payload switches to the JSON tree, which draws only what is in view.
  const full = page.waitForResponse((r) => r.url().endsWith("/api/streams/BLOBS/messages/1/payload") && r.status() === 200)
  await drawer.getByRole("button", { name: "Load full" }).click()
  expect((await (await full).body()).length).toBe(size)
  const tree = drawer.getByRole("list", { name: "Payload as JSON" })
  await expect(drawer.getByRole("button", { name: "JSON" })).toHaveAttribute("aria-pressed", "true")
  await expect(tree).toContainText("items: [")
  expect(await tree.getByRole("listitem").count()).toBeLessThan(100)
  await tree.focus()
  await page.keyboard.press("End")
  await expect(tree.getByRole("listitem").last()).toContainText("end: true")
  await page.keyboard.press("Home")
  await tree.getByRole("button", { name: "Collapse items" }).click()
  await expect(tree.getByRole("listitem")).toHaveCount(3)

  await drawer.getByRole("button", { name: "Hex" }).click()
  const hex = drawer.getByRole("list", { name: "Payload as hex" })
  await expect(hex.getByRole("listitem").first()).toContainText("00000000  7b 22 69 74 65 6d 73 22")
  expect(await hex.getByRole("listitem").count()).toBeLessThan(100)
  await hex.focus()
  await page.keyboard.press("End")
  await expect(hex.getByRole("listitem").last()).toContainText(`${(Math.ceil(size / 16) * 16 - 16).toString(16).padStart(8, "0")}  `)
  const longest = await page.evaluate(() => (window as unknown as { longest: number }).longest)
  console.log(`longest task while opening the 4 MB message: ${longest} ms`)
  expect(longest).toBeLessThan(1000)

  const download = page.waitForEvent("download")
  await drawer.getByRole("link", { name: "Download" }).click()
  const d = await download
  expect(d.suggestedFilename()).toBe("BLOBS-1.bin")
  expect(statSync(await d.path()).size).toBe(size)

  // Next and Prev; a binary payload opens as hex.
  await drawer.getByRole("button", { name: "Next message" }).click()
  const second = page.getByRole("dialog", { name: "Message #2" })
  await expect(second.getByRole("button", { name: "Hex" })).toHaveAttribute("aria-pressed", "true")
  await expect(second.getByRole("list", { name: "Payload as hex" }).getByRole("listitem").first()).toContainText("00 01 02 03")
  await second.getByRole("button", { name: "Previous message" }).click()
  await expect(page.getByRole("dialog", { name: "Message #1" })).toBeVisible()
  await expect(page.getByRole("dialog", { name: "Message #1" }).getByRole("button", { name: "Previous message" })).toBeDisabled()
})

test("Prev and Next cross page boundaries and gaps", async ({ page }) => {
  await activate(page)
  await page.goto("/streams/EVENTS/messages")
  const heading = page.getByRole("dialog").getByRole("heading")
  const jump = async (seq: number) => {
    await page.getByLabel("Sequence", { exact: true }).fill(String(seq))
    await page.getByRole("button", { name: "Jump to sequence" }).click()
    await expect(rows(page).getByRole("row").first()).toContainText(`#${seq}`)
  }

  // 1000 is the first loaded row, so Prev re-anchors below it.
  await jump(1000)
  await openRow(page, 1000)
  await expect(heading).toHaveText("Message #1000")
  await page.getByRole("button", { name: "Previous message" }).click()
  await expect(heading).toHaveText("Message #999")
  // Next walks off the end of the loaded pages.
  for (let seq = 1000; seq <= 1250; seq++) {
    await page.getByRole("button", { name: "Next message" }).click()
    await expect(heading).toHaveText(`Message #${seq}`)
  }
  await expect(page.locator('[role=row][aria-selected=true]')).toContainText("#1250") // behind the modal drawer, so not by role

  // Over the deleted 101-150, both ways.
  await page.keyboard.press("Escape")
  await jump(100)
  await openRow(page, 100)
  await page.getByRole("button", { name: "Next message" }).click()
  await expect(heading).toHaveText("Message #151")
  await page.getByRole("button", { name: "Previous message" }).click()
  await expect(heading).toHaveText("Message #100")
  await page.getByRole("button", { name: "Previous message" }).click()
  await expect(heading).toHaveText("Message #99")

  // Leave, so the view's consumer is gone before messages.spec counts consumers on EVENTS.
  await page.keyboard.press("Escape")
  await page.getByRole("navigation", { name: "Stream sections" }).getByRole("link", { name: "Overview" }).click()
  await expect.poll(async () => (await (await page.request.get("/api/streams/EVENTS")).json()).consumers).toBe(0)
})

test("Delete asks first, can erase, drops the row, and is blocked under Read-only", async ({ page }) => {
  await activate(page)
  await page.goto("/streams/BLOBS/messages")
  const status = page.getByRole("table", { name: "Messages" }).getByRole("status")
  await expect(status).toContainText("of ")
  const before = Number((await status.textContent())!.match(/of (\d+)/)![1])
  const last = Number((await rows(page).getByRole("row").last().getByRole("cell").first().textContent())!.slice(1))
  expect(last).toBeGreaterThan(2) // 3-12 are there to delete; re-seed after ten runs

  await openRow(page, last)
  const drawer = page.getByRole("dialog", { name: `Message #${last}` })
  await drawer.getByRole("button", { name: "Delete…" }).click()
  const confirm = page.getByRole("dialog", { name: `Delete message #${last}` })
  await confirm.getByLabel(/Erase/).check()
  await expect(confirm.getByRole("button", { name: `Copy as CLI: nats stream rmm BLOBS ${last} --force` })).toBeVisible()
  await confirm.getByRole("button", { name: "Delete message" }).click()
  // The last message has no next, so the drawer closes.
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(status).toContainText(`of ${before - 1}`)
  await expect(rows(page).getByRole("cell", { name: `#${last}`, exact: true })).toHaveCount(0)
  expect((await page.request.get(`/api/streams/BLOBS/messages/${last}`)).status()).toBe(404)

  const settings = "/api/contexts/cli/app/settings"
  await page.request.put(settings, { data: { readOnly: true } })
  try {
    await page.reload()
    await openRow(page, 1)
    const d = page.getByRole("dialog", { name: "Message #1" })
    await expect(d.getByRole("button", { name: "Delete…" })).toBeDisabled()
    await expect(d).toContainText("Read-only mode is on")
  } finally {
    await page.request.put(settings, { data: {} })
  }
})
