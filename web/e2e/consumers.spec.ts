import { expect, test } from "@playwright/test"

test("Consumers tab shows lag, labels Natter's own consumers, and pauses, resumes and deletes", async ({ page }) => {
  await page.request.put("/api/contexts/active", { data: { source: "cli", name: "app" } })
  await page.goto("/streams/ORDERS")
  await page.getByRole("navigation", { name: "Stream sections" }).getByRole("link", { name: "Consumers" }).click()
  await expect(page).toHaveURL(/\/streams\/ORDERS\/consumers$/)

  const table = page.getByRole("region", { name: "Consumers" })
  const billing = table.getByRole("row").filter({ has: page.getByRole("link", { name: "billing", exact: true }) })
  await expect(billing).toContainText("orders.eu.>")
  await expect(billing).toContainText("explicit")
  await expect(billing.getByRole("cell").nth(2)).toHaveText("2") // pending: the two orders.eu.new messages
  const own = table.getByRole("row").filter({ hasText: "natter_browse_e2e" })
  await expect(own).toContainText("Natter browsing")
  await expect(table.getByRole("row").filter({ hasText: "shipping" })).not.toContainText("Natter browsing")

  await billing.getByRole("link", { name: "billing" }).click()
  await expect(page).toHaveURL(/\/consumers\/billing$/)
  await expect(page.getByText("ack_policy")).toBeVisible()
  await page.getByRole("button", { name: "Pause", exact: true }).click()
  await expect(page.getByText(/Paused until/)).toBeVisible()
  await page.getByRole("button", { name: "Resume" }).click()
  await expect(page.getByText(/Paused until/)).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible()

  // Delete asks first; cancelling keeps it.
  await page.goto("/streams/ORDERS/consumers/shipping")
  await page.getByRole("button", { name: "Delete consumer…" }).click()
  await page.getByRole("button", { name: "Keep it" }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await page.getByRole("button", { name: "Delete consumer…" }).click()
  await page.getByRole("button", { name: "Delete consumer" }).click()
  await expect(page).toHaveURL(/\/streams\/ORDERS\/consumers$/)
  await expect(table.getByRole("link", { name: "shipping" })).toHaveCount(0)
})

test("Pause, resume and delete are blocked under Read-only mode", async ({ page }) => {
  await page.request.put("/api/contexts/active", { data: { source: "cli", name: "app" } })
  await page.request.put("/api/contexts/cli/app/settings", { data: { readOnly: true } })
  try {
    await page.goto("/streams/ORDERS/consumers/billing")
    for (const name of ["Pause", "Delete consumer…"]) {
      const b = page.getByRole("button", { name, exact: true })
      await expect(b).toHaveAttribute("aria-disabled", "true")
      await expect(b).toHaveAccessibleDescription(/Read-only mode is on for this Context/)
    }
  } finally {
    await page.request.put("/api/contexts/cli/app/settings", { data: {} })
  }
})
