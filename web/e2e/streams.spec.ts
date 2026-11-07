import { expect, test } from "@playwright/test"

test("Streams lists the account's streams, filters by subject, and opens one", async ({ page, context, browserName }) => {
  if (browserName === "chromium") await context.grantPermissions(["clipboard-read", "clipboard-write"])
  await page.request.put("/api/contexts/active", { data: { source: "cli", name: "app" } })
  await page.goto("/streams")

  const table = page.getByRole("region", { name: "Streams" })
  const orders = table.getByRole("row").filter({ has: page.getByRole("link", { name: "ORDERS", exact: true }) })
  await expect(orders).toContainText("orders.>")
  await expect(orders.getByRole("img", { name: "Healthy" })).toBeVisible()
  await expect(table.getByRole("row").filter({ hasText: "KV_config" })).toContainText("KV bucket")

  await page.getByLabel("Subject").fill("orders.eu.*")
  await page.getByRole("button", { name: "Filter" }).click()
  await expect(page).toHaveURL(/subject=orders\.eu\.\*/)
  await expect(table.getByRole("row")).toHaveCount(2) // header plus ORDERS
  const copy = page.getByRole("button", { name: "Copy as CLI: nats stream ls -a --subject 'orders.eu.*'" })
  await copy.click()
  await expect(copy.getByRole("status")).toHaveText("Copied")
  // WebKit lets only a user's paste read the clipboard back.
  if (browserName === "chromium") expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("nats stream ls -a --subject 'orders.eu.*'")

  await orders.getByRole("link", { name: "ORDERS" }).click()
  await expect(page).toHaveURL(/\/streams\/ORDERS$/)
  await expect(page.getByRole("heading", { level: 1 })).toContainText("ORDERS")
  await expect(page.getByRole("button", { name: "Copy as CLI: nats stream info ORDERS" })).toBeVisible()
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
  await expect(page.getByRole("button", { name: "Copy as CLI: nats stream info ORDERS --json" })).toBeVisible()
})
