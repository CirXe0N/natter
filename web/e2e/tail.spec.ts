import { expect, test, type Page } from "@playwright/test"

// internal/e2eserver publishes {"n":N} on e2e.tail.0-2 ten times a second.
const setReadOnly = (page: Page, readOnly: boolean) => page.request.put("/api/contexts/cli/app/settings", { data: { readOnly } })

test("tails a wildcard filter under Read-only mode, opens a row, filters, and pauses", async ({ page }) => {
  await setReadOnly(page, true)
  await page.request.put("/api/contexts/active", { data: { source: "cli", name: "app" } })
  try {
    await page.goto("/tail")
    await page.getByLabel("Subject filter").fill("e2e.tail.>")
    await page.getByRole("button", { name: "Tail", exact: true }).click()
    await expect(page).toHaveURL(/\/tail\?subject=e2e\.tail\./)
    await expect(page.getByRole("button", { name: "Tail", exact: true })).toHaveCount(0) // shows again only when the filter is edited

    const rows = page.getByRole("list", { name: "Tailed messages" }).getByRole("listitem")
    await expect(rows.first()).toContainText(/e2e\.tail\.\d/)
    await expect(rows.first()).toContainText('{"n":')
    await expect(page.getByText(/\d+ msgs\/s/)).toBeVisible()
    await expect(page.getByText("0 dropped by the rate cap")).toBeVisible()

    await rows.first().getByRole("button").click()
    const msg = page.getByRole("complementary", { name: "Message" })
    await expect(msg.getByRole("heading")).toHaveText(/e2e\.tail\.\d/)
    await expect(msg.locator("pre")).toContainText('"n":')
    await msg.getByRole("button", { name: "Close message" }).click()

    await page.getByLabel("Show rows containing").fill("e2e.tail.1")
    await expect(rows.first()).toContainText("e2e.tail.1")
    await expect(rows.filter({ hasText: "e2e.tail.2" })).toHaveCount(0)
    await page.getByRole("button", { name: "Clear filter" }).click()
    await expect(page.getByLabel("Show rows containing")).toHaveValue("")

    await page.getByRole("button", { name: "Pause live updates" }).click()
    await expect(page.getByRole("button", { name: "Resume live updates" })).toBeVisible()
    const frozen = await rows.first().textContent()
    await page.waitForTimeout(1_500)
    expect(await rows.first().textContent()).toBe(frozen)

    await page.getByRole("button", { name: "Resume live updates" }).click()
    await expect(page.getByText(/messages? not shown: paused\./)).toBeVisible()
    await expect.poll(() => rows.first().textContent()).not.toBe(frozen)
  } finally {
    await setReadOnly(page, false)
  }
})

test("an invalid filter says why", async ({ page }) => {
  await page.request.put("/api/contexts/active", { data: { source: "cli", name: "app" } })
  await page.goto("/tail?subject=orders.%3E.x")
  await expect(page.getByRole("alert")).toContainText('"orders.>.x" is not a valid subject filter')
})
