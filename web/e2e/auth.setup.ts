import { expect, test as setup } from "@playwright/test"

setup("trade the Launch token for a session cookie", async ({ page }) => {
  await page.goto(`/launch?token=${process.env.E2E_TOKEN}`)
  await expect(page.getByRole("navigation", { name: "Screens" })).toBeVisible()
  await page.context().storageState({ path: "playwright/.auth/session.json" })
})
