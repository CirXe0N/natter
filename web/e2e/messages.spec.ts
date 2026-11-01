import { expect, test, type Page } from "@playwright/test"

// EVENTS (internal/e2eserver) holds 200,000 messages with 5 and 101-150 deleted.
const stored = 200_000 - 51

const consumers = async (page: Page) => (await (await page.request.get("/api/streams/EVENTS")).json()).consumers as number

test("the Messages tab scrolls a large stream with gaps, jumps, filters, and leaves no consumer", async ({ page }) => {
  await page.request.put("/api/contexts/active", { data: { source: "cli", name: "app" } })
  await page.goto("/streams/EVENTS")
  await page.getByRole("link", { name: "Messages" }).click()
  await expect(page).toHaveURL(/\/streams\/EVENTS\/messages$/)

  const body = page.getByRole("rowgroup", { name: "Message rows" })
  const row = (seq: number) => body.getByRole("row").filter({ has: page.getByRole("cell", { name: `#${seq}`, exact: true }) })
  const top = () => body.getByRole("row").first()
  const status = page.getByRole("table", { name: "Messages" }).getByRole("status")

  await expect(row(1)).toContainText('{"n":1}')
  await expect(row(1)).toContainText("events.b")
  await expect(row(3)).toContainText("binary")
  await expect(row(7)).toContainText("64.0 KiB")
  await expect(row(7)).toContainText("not loaded until opened")
  await expect(status).toContainText(`of ${stored}`)
  // The gap at 5: 4 and 6 are neighbours.
  await expect(row(4)).toHaveAttribute("aria-rowindex", "5")
  await expect(row(6)).toHaveAttribute("aria-rowindex", "6")

  // 6.4M px of rows on a capped track, yet a wheel step moves 1:1: 10 rows down is #12.
  expect(await body.evaluate((el) => el.scrollHeight)).toBe(4_000_000)
  await body.hover()
  await page.mouse.wheel(0, 320)
  await expect(top()).toContainText("#12")
  // The gap at 101-150: index 98 is #100, index 99 is #151.
  for (let rows = 10; rows < 97; rows += 3) {
    await page.mouse.wheel(0, Math.min(3, 97 - rows) * 32) // one wheel step per frame, as a real wheel sends them
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
  }
  await expect(top()).toContainText("#99")
  await expect(row(151)).toHaveAttribute("aria-rowindex", String(99 + 2))

  // End pins to the end of the stream, which re-anchors the view there.
  await body.focus()
  await page.keyboard.press("End")
  await expect(body.getByRole("row").last()).toContainText("#200000")
  await expect(status).toContainText(`of ${stored}`)

  // A jump into the gap starts at the next message.
  await page.getByLabel("Sequence", { exact: true }).fill("120")
  await page.getByRole("button", { name: "Jump to sequence" }).click()
  await expect(top()).toContainText("#151")
  await expect(page.getByRole("button", { name: "Copy as CLI: nats stream view EVENTS --id 151" })).toBeVisible()

  await page.getByLabel("Subject", { exact: true }).fill("events.a")
  await page.getByRole("button", { name: "Filter" }).click()
  await expect(status).toContainText(`of ${100_000 - 25} matching events.a`)
  await expect(top()).toContainText("#2")
  await expect(body.getByRole("row").filter({ hasText: "events.b" })).toHaveCount(0)

  // Leaving the tab deletes the view's consumer.
  expect(await consumers(page)).toBe(1)
  await page.getByRole("navigation", { name: "Stream sections" }).getByRole("link", { name: "Overview" }).click()
  await expect.poll(() => consumers(page)).toBe(0)
})

test("the Messages tab browses under Read-only mode", async ({ page }) => {
  await page.request.put("/api/contexts/active", { data: { source: "cli", name: "app" } })
  const settings = "/api/contexts/cli/app/settings"
  await page.request.put(settings, { data: { readOnly: true } })
  try {
    await page.goto("/streams/ORDERS/messages")
    await expect(page.getByRole("rowgroup", { name: "Message rows" }).getByRole("row")).toHaveCount(3)
  } finally {
    await page.request.put(settings, { data: {} })
  }
})

test("the Message browser screen picks a stream, browses it, and opens a message; Key-Value is not in the sidebar", async ({ page }) => {
  await page.request.put("/api/contexts/active", { data: { source: "cli", name: "app" } })
  await page.goto("/overview")
  const nav = page.getByRole("navigation", { name: "Screens" })
  await expect(nav.getByRole("link", { name: "Key-Value" })).toHaveCount(0)
  await nav.getByRole("link", { name: "Message browser" }).click()
  await expect(page).toHaveURL(/\/messages$/)
  await expect(page.getByText("Nothing to show here yet")).toHaveCount(0)

  await page.getByLabel("Stream", { exact: true }).selectOption("EVENTS")
  await expect(page).toHaveURL(/\/messages\?stream=EVENTS$/)
  const body = page.getByRole("rowgroup", { name: "Message rows" })
  await expect(body.getByRole("row").first()).toContainText("#1")
  await expect(page.getByRole("table", { name: "Messages" }).getByRole("status")).toContainText(`of ${stored}`)
  await expect(page.getByText("Browsing · no side effects")).toBeVisible()

  await page.getByLabel("Sequence", { exact: true }).fill("151")
  await page.getByRole("button", { name: "Jump to sequence" }).click()
  await expect(body.getByRole("row").first()).toContainText("#151")
  await body.getByRole("row").first().click()
  const drawer = page.getByRole("dialog", { name: "Message #151" })
  await expect(drawer).toContainText("EVENTS · seq 151")
  await page.keyboard.press("ArrowDown")
  await expect(page.getByRole("dialog", { name: "Message #152" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toHaveCount(0)
})
