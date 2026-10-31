import { expect, test } from "@playwright/test"

const activate = (page: import("@playwright/test").Page, name: string) =>
  page.request.put("/api/contexts/active", { data: { source: "cli", name } })

test("Health shows each server, and the Overview links to it", async ({ page }) => {
  await activate(page, "sys")
  await page.goto("/overview")
  await page.getByRole("link", { name: "All servers healthy" }).click()
  await expect(page.getByRole("heading", { name: "Health", level: 1 })).toBeVisible()
  await expect(page.getByRole("heading", { level: 2 }).filter({ hasText: "Healthy" })).toHaveCount(1)

  await page.request.put("/api/contexts/cli/app/settings", { data: {} })
  await activate(page, "app")
  await page.goto("/health")
  await expect(page.getByRole("heading", { name: "Server health is not available" })).toBeVisible()
})
