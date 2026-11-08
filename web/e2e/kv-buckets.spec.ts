import { expect, test } from "@playwright/test"

test("Key-Value Store sits in the sidebar's JetStream group, after Message browser", async ({ page }) => {
  await page.request.put("/api/contexts/active", { data: { source: "cli", name: "app" } })
  await page.goto("/overview")
  const nav = page.getByRole("navigation", { name: "Screens" })
  const links = await nav.getByRole("link").allTextContents()
  expect(links.slice(links.indexOf("Streams"))).toEqual(["Streams", "Consumers", "Message browser", "Key-Value Store"])
  await nav.getByRole("link", { name: "Key-Value Store" }).click()
  await expect(page).toHaveURL(/\/kv$/)
  await expect(page.getByRole("heading", { level: 1, name: "Key-Value Store" })).toBeVisible()
  await expect(page).toHaveTitle("Key-Value Store · Natter")
  await expect(nav.getByRole("link", { name: "Key-Value Store" })).toHaveAttribute("aria-current", "page")

  // The palette's Create bucket opens the same form.
  await page.keyboard.press("Control+k")
  await page.keyboard.type("create bucket")
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(/\/kv\/new$/)
})

test("create a bucket from Key-Value Store, see a bad name refused on its field, find it in the list and open it", async ({ page }) => {
  await page.request.put("/api/contexts/active", { data: { source: "cli", name: "app" } })
  try {
    await page.goto("/overview")
    await page.getByRole("navigation", { name: "Screens" }).getByRole("link", { name: "Key-Value Store" }).click()
    await page.getByRole("button", { name: "New bucket" }).click()
    await expect(page).toHaveURL(/\/kv\/new$/)
    await expect(page.getByRole("heading", { level: 1, name: "New bucket" })).toBeVisible()

    const name = page.getByLabel("Name", { exact: true })
    await name.fill("scratch.kv")
    await page.getByRole("button", { name: "Create bucket" }).click()
    await expect(name).toHaveAttribute("aria-invalid", "true")
    await expect(page.getByText("Use only letters, numbers, - and _.")).toBeVisible()

    await name.fill("scratch_kv")
    await page.getByLabel("History", { exact: true }).fill("5")
    await page.getByLabel("TTL", { exact: true }).fill("1h")
    await page.getByRole("button", { name: "Create bucket" }).click()
    await expect(page).toHaveURL(/\/kv$/) // back to the bucket list, which shows it
    const row = page.getByRole("region", { name: "Buckets" }).getByRole("row").filter({ hasText: "scratch_kv" })
    await expect(row.getByRole("cell").nth(1)).toHaveText("5") // History
    await row.getByRole("link", { name: "scratch_kv" }).click()
    await expect(page).toHaveURL(/\/kv\/scratch_kv$/)

    // Edit opens the same form, filled in, with the fields that cannot change disabled.
    await page.getByRole("button", { name: "Edit" }).click()
    await expect(page).toHaveURL(/\/kv\/scratch_kv\/edit$/)
    await expect(page.getByRole("heading", { level: 1, name: "Edit bucket" })).toBeVisible()
    await expect(name).toHaveValue("scratch_kv")
    await expect(name).toBeDisabled()
    await expect(page.getByRole("combobox", { name: "Storage" })).toBeDisabled()
    await expect(page.getByLabel("TTL", { exact: true })).toHaveValue("1h")
    await page.getByLabel("History", { exact: true }).fill("7")
    await page.getByLabel("Description", { exact: true }).fill("edited in e2e")
    await page.getByRole("button", { name: "Save changes" }).click()
    await expect(page).toHaveURL(/\/kv\/scratch_kv$/)
    await page.getByRole("link", { name: "All buckets" }).click()
    await expect(row.getByRole("cell").nth(1)).toHaveText("7")

    // Delete asks for the name first, then returns to the list.
    await row.getByRole("link", { name: "scratch_kv" }).click()
    await page.getByRole("button", { name: "Delete…" }).click()
    const dialog = page.getByRole("dialog", { name: "Delete scratch_kv" })
    const confirm = dialog.getByRole("button", { name: "Delete bucket" })
    await expect(confirm).toBeDisabled()
    await dialog.getByLabel(/Type scratch_kv to confirm/).fill("scratch_kv")
    await confirm.click()
    await expect(page).toHaveURL(/\/kv$/)
    await expect(page.getByRole("region", { name: "Buckets" }).getByRole("row").filter({ hasText: "scratch_kv" })).toHaveCount(0)
  } finally {
    await page.request.delete("/api/kv/scratch_kv", { data: { confirm: "scratch_kv" } }) // in case the test stopped before its own delete
  }
})

test("Read-only mode disables New bucket, and a bucket's Edit and Delete", async ({ page }) => {
  await page.request.put("/api/contexts/active", { data: { source: "cli", name: "app" } })
  const settings = "/api/contexts/cli/app/settings"
  await page.request.put(settings, { data: { readOnly: true } })
  try {
    await page.goto("/kv")
    await expect(page.getByRole("button", { name: "New bucket" })).toBeDisabled()
    await page.goto("/kv/sessions")
    await expect(page.getByRole("button", { name: "Edit" })).toBeDisabled()
    await expect(page.getByRole("button", { name: "Delete…" })).toBeDisabled()
  } finally {
    await page.request.put(settings, { data: {} })
  }
})
