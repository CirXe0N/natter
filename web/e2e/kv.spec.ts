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

test("a bucket's keys update live, filter by prefix, and open with value and history", async ({ page }) => {
  await page.request.put("/api/contexts/active", { data: { source: "cli", name: "app" } })
  const keys = await openSessions(page)
  const row = (key: string) => keys.getByRole("row").filter({ has: page.getByRole("button", { name: key, exact: true }) })

  // Puts and deletes arrive over the socket.
  const clock = row("clock").getByRole("cell").first()
  const rev = await clock.textContent()
  await expect(clock).not.toHaveText(rev!)
  await expect(row("blink")).toHaveCount(1)
  await expect(row("blink")).toHaveCount(0)

  await page.getByLabel("Key prefix").fill("user.")
  await expect(keys.getByRole("row")).toHaveCount(2) // header plus user.1
  await expect(page.getByRole("button", { name: /Copy as CLI: nats kv watch sessions 'user\.>'/ })).toBeVisible()

  await row("user.1").getByRole("button").click()
  const detail = page.getByRole("region", { name: "Key user.1" })
  await expect(detail.locator("pre")).toHaveText('{"user":1,"cart":3}')
  const revisions = detail.getByRole("list", { name: "Revisions" }).getByRole("listitem")
  await expect(revisions).toHaveCount(3)
  await revisions.last().getByRole("button").click() // the oldest
  await expect(detail.locator("pre")).toHaveText("v1")
  await expect(detail.getByRole("button", { name: /Copy as CLI: nats kv get sessions user\.1 --revision \d+/ })).toBeVisible()
})

test("Key-Value browses under Read-only mode", async ({ page }) => {
  await page.request.put("/api/contexts/active", { data: { source: "cli", name: "app" } })
  const settings = "/api/contexts/cli/app/settings"
  await page.request.put(settings, { data: { readOnly: true } })
  try {
    const keys = await openSessions(page)
    await keys.getByRole("button", { name: "user.1", exact: true }).click()
    await expect(page.getByRole("region", { name: "Key user.1" }).locator("pre")).toHaveText('{"user":1,"cart":3}')
  } finally {
    await page.request.put(settings, { data: {} })
  }
})
