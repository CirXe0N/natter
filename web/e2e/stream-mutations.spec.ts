import { expect, test } from "@playwright/test"

test("create a stream, see a refusal on its field, then delete it with the name typed", async ({ page }) => {
  await page.request.put("/api/contexts/active", { data: { source: "cli", name: "app" } })
  await page.goto("/streams")
  await page.getByRole("button", { name: "New stream" }).click()
  await expect(page).toHaveURL(/\/streams\/new$/)

  await page.getByLabel("Name", { exact: true }).fill("SCRATCH")
  await page.getByRole("textbox", { name: "Subjects" }).fill("orders.>") // overlaps ORDERS
  await page.getByRole("button", { name: "Create stream" }).click()
  await expect(page.getByText(/overlap/i)).toBeVisible()
  await expect(page.getByRole("textbox", { name: "Subjects" })).toHaveAttribute("aria-invalid", "true")

  await page.getByRole("textbox", { name: "Subjects" }).fill("scratch.>")
  await page.getByRole("button", { name: "Create stream" }).click()
  await expect(page).toHaveURL(/\/streams\/SCRATCH$/)

  await page.getByRole("button", { name: "Delete…" }).click()
  const dialog = page.getByRole("dialog")
  const confirm = dialog.getByRole("button", { name: "Delete stream" })
  await expect(confirm).toBeDisabled()
  await dialog.getByLabel(/Type SCRATCH to confirm/).fill("SCRATC")
  await expect(confirm).toBeDisabled()
  await dialog.getByLabel(/Type SCRATCH to confirm/).fill("SCRATCH")
  await confirm.click()

  await expect(page).toHaveURL(/\/streams$/)
  await expect(page.getByRole("link", { name: "SCRATCH", exact: true })).toHaveCount(0)
  await expect(page.getByRole("link", { name: "ORDERS", exact: true })).toBeVisible()
})
