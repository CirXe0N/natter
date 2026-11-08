import { expect, test } from "@playwright/test"

test("a stream's Consumers tab only lists them; a consumer opens under Consumers to pause, resume and delete", async ({ page }) => {
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
  await expect(page.getByRole("button", { name: "New consumer" })).toHaveCount(0) // created under Consumers, not here

  await billing.getByRole("link", { name: "billing" }).click()
  await expect(page).toHaveURL(/\/consumers\/ORDERS\/billing$/)
  await expect(page.getByRole("navigation", { name: "Screens" }).getByRole("link", { name: "Consumers" })).toHaveAttribute("aria-current", "page")
  await expect(page.getByText("ack_policy")).toBeVisible()
  const detail = page.getByRole("region", { name: "Consumer" })
  await detail.getByRole("button", { name: "Pause", exact: true }).click()
  await expect(page.getByText(/Paused until/)).toBeVisible()
  await detail.getByRole("button", { name: "Resume" }).click()
  await expect(page.getByText(/Paused until/)).toHaveCount(0)
  await expect(detail.getByRole("button", { name: "Pause", exact: true })).toBeVisible()

  // Delete asks for the name; closing the dialog keeps it.
  await page.goto("/consumers/ORDERS/shipping")
  await detail.getByRole("button", { name: "Delete…" }).click()
  const dialog = page.getByRole("dialog", { name: "Delete consumer shipping" })
  await expect(dialog.getByRole("button", { name: "Delete consumer" })).toBeDisabled()
  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
  await detail.getByRole("button", { name: "Delete…" }).click()
  await expect(dialog.getByRole("button", { name: /nats consumer rm ORDERS shipping --force/ })).toBeVisible()
  await dialog.getByLabel(/Type shipping to confirm/).fill("shipping")
  await dialog.getByRole("button", { name: "Delete consumer" }).click()
  await expect(page).toHaveURL(/\/consumers$/)
  await expect(page.getByRole("region", { name: "Consumers" }).getByRole("link", { name: "billing", exact: true })).toBeVisible()
  await expect(page.getByRole("region", { name: "Consumers" }).getByRole("link", { name: "shipping" })).toHaveCount(0)
})

test("Create, edit, pause, resume and delete are blocked under Read-only mode", async ({ page }) => {
  await page.request.put("/api/contexts/active", { data: { source: "cli", name: "app" } })
  await page.request.put("/api/contexts/cli/app/settings", { data: { readOnly: true } })
  try {
    await page.goto("/consumers/ORDERS/billing")
    const detail = page.getByRole("region", { name: "Consumer" })
    for (const name of ["Pause", "Edit", "Delete…"]) {
      const b = detail.getByRole("button", { name, exact: true })
      await expect(b).toHaveAttribute("aria-disabled", "true")
      await expect(b).toHaveAccessibleDescription(/Read-only mode is on for this Context/)
    }
    await page.goto("/consumers")
    const add = page.getByRole("button", { name: "New consumer" })
    await expect(add).toHaveAttribute("aria-disabled", "true")
    await expect(add).toHaveAccessibleDescription(/Read-only mode is on for this Context/)
  } finally {
    await page.request.put("/api/contexts/cli/app/settings", { data: {} })
  }
})

test("create a consumer with the form, edit it, and see server refusals on their field", async ({ page }) => {
  await page.request.put("/api/contexts/active", { data: { source: "cli", name: "app" } })
  await page.goto("/consumers")
  await page.getByRole("button", { name: "New consumer" }).click()
  await expect(page).toHaveURL(/\/consumers\/new$/)
  const form = page.getByRole("form", { name: "New consumer" })

  // The stream comes first; a taken name comes back from the server and lands on Name.
  await form.getByLabel("Name", { exact: true }).fill("billing")
  await form.getByRole("button", { name: "Create consumer" }).click()
  const stream = form.getByRole("combobox", { name: "Stream", exact: true })
  await expect(stream).toHaveAttribute("aria-invalid", "true")
  await stream.click()
  await page.getByRole("option", { name: "ORDERS", exact: true }).click()
  await expect(stream).toHaveText("ORDERS")
  await form.getByRole("button", { name: "Create consumer" }).click()
  await expect(form.getByRole("alert")).toContainText('A consumer named "billing" already exists')
  await expect(form.getByLabel("Name", { exact: true })).toHaveAttribute("aria-invalid", "true")

  await form.getByLabel("Name", { exact: true }).fill("audit-e2e")
  await form.getByLabel("Description").fill("made in Natter")
  await form.getByLabel("Filter subjects").fill("orders.eu.>\norders.us.>")
  await form.getByLabel("Max deliveries").fill("5")
  await form.getByLabel("Backoff").fill("1s, 5s")
  await form.getByLabel("Metadata").fill("team=ops")
  await expect(form.getByRole("group", { name: "Ack policy" }).getByRole("button", { name: "Explicit" })).toHaveAttribute("aria-pressed", "true")
  await expect(form.getByRole("button", { name: /nats consumer add ORDERS audit-e2e --pull --ack explicit/ })).toBeVisible()

  // Push swaps the pull options for the push ones.
  await form.getByRole("group", { name: "Type" }).getByRole("button", { name: "Push" }).click()
  await expect(form.getByLabel("Deliver subject")).toBeVisible()
  await expect(form.getByLabel("Max waiting pulls")).toHaveCount(0)
  await form.getByRole("group", { name: "Type" }).getByRole("button", { name: "Pull" }).click()

  await form.getByRole("button", { name: "JSON" }).click()
  await expect(page.getByRole("region", { name: "Config JSON" })).toContainText('"filter_subjects": [')
  await form.getByRole("button", { name: "Create consumer" }).click()
  await expect(page).toHaveURL(/\/consumers\/ORDERS\/audit-e2e$/)
  const detail = page.getByRole("region", { name: "Consumer" })
  await expect(detail).toContainText("Durable · pull · ack explicit · filter orders.eu.>, orders.us.>")
  await expect(page.getByText("made in Natter")).toBeVisible()

  await detail.getByRole("button", { name: "Edit" }).click()
  await expect(page).toHaveURL(/\/consumers\/ORDERS\/audit-e2e\/edit$/)
  const edit = page.getByRole("form", { name: "Edit consumer audit-e2e" })
  await expect(edit.getByLabel("Name", { exact: true })).toHaveAttribute("readonly", "")
  await expect(edit.getByRole("group", { name: "Ack policy" }).getByRole("button", { name: "All" })).toBeDisabled()
  await expect(edit.getByLabel("Backoff")).toHaveValue("1s, 5s")
  await edit.getByLabel("Max deliveries").fill("9")
  await expect(edit.getByRole("button", { name: "Copy as CLI: nats consumer edit ORDERS audit-e2e --max-deliver 9 --force" })).toBeVisible()
  await edit.getByRole("button", { name: "Save changes" }).click()
  await expect(page).toHaveURL(/\/consumers\/ORDERS\/audit-e2e$/)
  await expect(page.getByRole("definition").filter({ hasText: /^9$/ })).toBeVisible()

  await detail.getByRole("button", { name: "Delete…" }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel(/Type audit-e2e to confirm/).fill("audit-e2e")
  await dialog.getByRole("button", { name: "Delete consumer" }).click()
  await expect(page).toHaveURL(/\/consumers$/)
})

test("the Consumers screen lists every stream's consumers, filters them, and opens the new consumer form", async ({ page }) => {
  await page.request.put("/api/contexts/active", { data: { source: "cli", name: "app" } })
  await page.goto("/overview")
  await page.getByRole("navigation", { name: "Screens" }).getByRole("link", { name: "Consumers" }).click()
  await expect(page).toHaveURL(/\/consumers$/)
  await expect(page.getByText("Nothing to show here yet")).toHaveCount(0)

  const table = page.getByRole("region", { name: "Consumers" })
  const billing = table.getByRole("row").filter({ has: page.getByRole("link", { name: "billing", exact: true }) })
  await expect(billing).toContainText("ORDERS")
  await expect(billing).toContainText("orders.eu.>")
  await expect(table.getByText("natter_browse_e2e")).toHaveCount(0) // Natter's own are hidden by default
  await page.getByLabel("Show Natter's browsing consumers").check()
  await expect(table.getByText("natter_browse_e2e")).toBeVisible()

  await page.getByLabel("Filter consumers").fill("bill")
  await expect(table.getByText("natter_browse_e2e")).toBeVisible() // typing alone filters nothing
  await page.getByLabel("Filter consumers").press("Enter")
  await expect(table.getByRole("link", { name: "billing", exact: true })).toBeVisible()
  await expect(table.getByText("natter_browse_e2e")).toHaveCount(0)

  await billing.getByRole("link", { name: "billing", exact: true }).click()
  await expect(page).toHaveURL(/\/consumers\/ORDERS\/billing$/)

  await page.goBack()
  await page.getByRole("button", { name: "New consumer" }).click()
  await expect(page).toHaveURL(/\/consumers\/new$/)
})
