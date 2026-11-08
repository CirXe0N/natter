import { expect, test, type Page } from "@playwright/test"

// sessions (internal/e2eserver) holds user.1 at three revisions, and a writer
// puts clock every 300 ms and puts or deletes blink every 700 ms.
async function openSessions(page: Page) {
  await page.goto("/kv")
  const buckets = page.getByRole("region", { name: "Buckets" })
  await expect(buckets.getByRole("row").filter({ hasText: "config" })).toBeVisible()
  await buckets.getByRole("link", { name: "sessions" }).click()
  await expect(page).toHaveURL(/\/kv\/sessions$/)
  return page.getByRole("region", { name: "Keys" })
}

test("a bucket's keys update live and open with value and history", async ({ page }) => {
  await page.request.put("/api/contexts/active", { data: { source: "cli", name: "app" } })
  const keys = await openSessions(page)
  const row = (key: string) => keys.getByRole("row").filter({ has: page.getByRole("button", { name: key, exact: true }) })

  // Puts and deletes arrive over the socket.
  const clock = row("clock").getByRole("cell").first()
  const rev = await clock.textContent()
  await expect(clock).not.toHaveText(rev!)
  await expect(row("blink")).toHaveCount(1)
  await expect(row("blink")).toHaveCount(0)

  await expect(page.getByLabel("Key prefix")).toHaveCount(0) // the list has no filter

  await row("user.1").getByRole("button").click()
  const detail = page.getByRole("region", { name: "Key user.1" })
  // The value opens in the payload viewer, as a JSON tree since it parses.
  await expect(detail.getByRole("button", { name: "JSON" })).toHaveAttribute("aria-pressed", "true")
  await expect(detail.getByRole("list", { name: "Payload as JSON" }).getByRole("listitem")).toHaveText(["{2}", "user: 1", "cart: 3"])
  await expect(detail.getByText("19 B")).toBeVisible()
  // A small value's viewer is as tall as its three rows, not a fixed box.
  await expect.poll(async () => (await detail.getByRole("list", { name: "Payload as JSON" }).boundingBox())?.height).toBe(60)
  const revisions = detail.getByRole("list", { name: "Revisions" }).getByRole("listitem")
  await expect(revisions).toHaveCount(3)
  await revisions.last().getByRole("button").click() // the oldest
  await expect(detail.getByRole("list", { name: "Payload as text" })).toHaveText("v1")
  await expect(page.getByRole("button", { name: /Copy as CLI/ })).toHaveCount(0) // Key-Value screens show no nats commands
})

test("Key-Value Store browses under Read-only mode", async ({ page }) => {
  await page.request.put("/api/contexts/active", { data: { source: "cli", name: "app" } })
  const settings = "/api/contexts/cli/app/settings"
  await page.request.put(settings, { data: { readOnly: true } })
  try {
    const keys = await openSessions(page)
    await keys.getByRole("button", { name: "user.1", exact: true }).click()
    await expect(page.getByRole("region", { name: "Key user.1" }).getByRole("list", { name: "Payload as JSON" })).toContainText("cart: 3")
  } finally {
    await page.request.put(settings, { data: {} })
  }
})
