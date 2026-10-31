import { expect, test, type Page } from "@playwright/test"

const activate = (page: Page, name: string) => page.request.put("/api/contexts/active", { data: { source: "cli", name } })
const settings = (page: Page, name: string, data: object) => page.request.put(`/api/contexts/cli/${name}/settings`, { data })

test("lists Connections, sorts, filters, shows subscriptions, and kicks after a confirmation", async ({ page }) => {
  await settings(page, "app", {})
  await activate(page, "app")
  await page.goto("/connections")
  await expect(page.getByRole("heading", { name: "Connections are not available" })).toBeVisible()

  await activate(page, "sys")
  await page.goto("/connections")
  await expect(page.getByRole("link", { name: "orders-service" })).toBeVisible()
  const names = page.getByRole("rowheader")
  await page.getByRole("button", { name: "Name" }).click()
  await expect(page.getByRole("columnheader", { name: "Name" })).toHaveAttribute("aria-sort", "ascending")
  await page.getByRole("button", { name: "Name" }).click()
  await expect(page.getByRole("columnheader", { name: "Name" })).toHaveAttribute("aria-sort", "descending")

  const filter = page.getByRole("textbox", { name: /Filter by/ })
  await filter.fill("orders.")
  await expect(names).toHaveCount(1)
  await filter.fill("no-such-thing")
  await expect(page.getByText("No Connections.")).toBeVisible()
  await filter.fill("APP")
  await expect(page.getByRole("link", { name: "orders-service" })).toBeVisible()

  await page.getByRole("link", { name: "orders-service" }).click()
  const panel = page.getByRole("complementary", { name: "Connection details" })
  await expect(panel.getByRole("listitem")).toHaveText("orders.>")

  await panel.getByRole("button", { name: "Kick…" }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toContainText("--context 'sys' request '$SYS.REQ.SERVER.")
  await expect(dialog).toContainText(`.KICK' '{"cid":`)
  await dialog.getByRole("button", { name: "Cancel" }).click()
  await expect(dialog).toBeHidden()

  await panel.getByRole("button", { name: "Kick…" }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Kick", exact: true }).click()
  await expect(page.getByRole("dialog")).toBeHidden()

  await page.getByRole("button", { name: "Recently closed" }).click()
  await expect(page.getByRole("row").filter({ hasText: "orders-service" }).filter({ hasText: "Kicked" }).first()).toBeVisible()
})

test("Kick is blocked, with the reason, under Read-only mode and without System credentials", async ({ page }) => {
  await settings(page, "sys", { readOnly: true })
  try {
    await activate(page, "sys")
    await page.goto("/connections")
    await page.getByRole("link", { name: "orders-service" }).click()
    const kick = page.getByRole("button", { name: "Kick…" })
    await expect(kick).toHaveAttribute("aria-disabled", "true")
    await expect(kick).toHaveAccessibleDescription(/Read-only mode is on/)
  } finally {
    await settings(page, "sys", {})
  }

  await settings(page, "app", { monitoringUrl: process.env.E2E_MONITORING })
  try {
    await activate(page, "app")
    await page.goto("/connections")
    await expect(page.getByText("One server, via the Monitoring URL")).toBeVisible()
    await page.getByRole("link", { name: "orders-service" }).click()
    const kick = page.getByRole("button", { name: "Kick…" })
    await expect(kick).toHaveAttribute("aria-disabled", "true")
    await expect(kick).toHaveAccessibleDescription("Kick needs System credentials. This Context has none.")
  } finally {
    await settings(page, "app", {})
  }
})
