import { expect, test } from "@playwright/test"

test("Streams lists the account's streams, filters by subject, and opens one", async ({ page }) => {
  await page.request.put("/api/contexts/active", { data: { source: "cli", name: "app" } })
  await page.goto("/streams")

  const table = page.getByRole("region", { name: "Streams" })
  const orders = table.getByRole("row").filter({ has: page.getByRole("link", { name: "ORDERS", exact: true }) })
  await expect(orders).toContainText("orders.>")
  await expect(orders.getByRole("img", { name: "Healthy" })).toBeVisible()
  await expect(table.getByRole("row").filter({ hasText: "KV_config" })).toContainText("KV bucket")

  await page.getByLabel("Subject").fill("orders.eu.*")
  await expect(page).toHaveURL(/subject=orders\.eu\.\*/)
  await expect(table.getByRole("row")).toHaveCount(2) // header plus ORDERS

  // A filter changed from outside (here the sidebar's plain /streams) shows in the box.
  await page.getByRole("navigation", { name: "Screens" }).getByRole("link", { name: "Streams" }).click()
  await expect(page).not.toHaveURL(/subject=/)
  await expect(page.getByLabel("Subject")).toHaveValue("")
  // Clear hands focus back to the box rather than dropping it on the page.
  await page.getByLabel("Subject").fill("orders.eu.*")
  await page.getByRole("button", { name: "Clear filter" }).click()
  await expect(page.getByLabel("Subject")).toBeFocused()
  await expect(page.getByLabel("Subject")).toHaveValue("")
  await page.getByLabel("Subject").fill("orders.eu.*")
  await expect(table.getByRole("row")).toHaveCount(2)

  await orders.getByRole("link", { name: "ORDERS" }).click()
  await expect(page).toHaveURL(/\/streams\/ORDERS$/)
  await expect(page.getByRole("heading", { level: 1 })).toContainText("ORDERS")
  const stats = page.locator("dl").first()
  await expect(stats).toContainText("Messages3")
  await expect(stats).toContainText("Largest message8.0 MiB") // natstest raises max_payload for the 4 MB message in BLOBS

  const subjects = page.getByRole("region", { name: "Subjects" })
  await subjects.getByRole("button", { name: /orders\./ }).click()
  await subjects.getByRole("button", { name: /eu\./ }).click()
  await expect(subjects.getByText("new", { exact: true })).toBeVisible()
  await expect(subjects.getByRole("button", { name: /eu\./ })).toContainText("2")

  await page.getByRole("link", { name: "Config" }).click()
  await expect(page).toHaveURL(/\/streams\/ORDERS\/config$/)
  await expect(page.getByText("The server's max_payload of 8.0 MiB applies.")).toBeVisible()
})
