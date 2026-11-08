import { expect, test } from "@playwright/test"

test("Key-Value sits in the sidebar's JetStream group, after Message browser", async ({ page }) => {
  await page.request.put("/api/contexts/active", { data: { source: "cli", name: "app" } })
  await page.goto("/overview")
  const nav = page.getByRole("navigation", { name: "Screens" })
  const links = await nav.getByRole("link").allTextContents()
  expect(links.slice(links.indexOf("Streams"))).toEqual(["Streams", "Consumers", "Message browser", "Key-Value"])
  await nav.getByRole("link", { name: "Key-Value" }).click()
  await expect(page).toHaveURL(/\/kv$/)
  await expect(nav.getByRole("link", { name: "Key-Value" })).toHaveAttribute("aria-current", "page")

  // The palette's Create bucket opens the same form.
  await page.keyboard.press("Control+k")
  await page.keyboard.type("create bucket")
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(/\/kv\/new$/)
})

test("create a bucket from Key-Value, see a bad name refused on its field, then open it", async ({ page }) => {
  await page.request.put("/api/contexts/active", { data: { source: "cli", name: "app" } })
  try {
    await page.goto("/overview")
    await page.getByRole("navigation", { name: "Screens" }).getByRole("link", { name: "Key-Value" }).click()
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
    await expect(page).toHaveURL(/\/kv\/scratch_kv$/)
    await expect(page.getByText("This bucket has no keys.")).toBeVisible()

    await page.getByRole("link", { name: "All buckets" }).click()
    const row = page.getByRole("region", { name: "Buckets" }).getByRole("row").filter({ hasText: "scratch_kv" })
    await expect(row.getByRole("cell").nth(1)).toHaveText("5") // History
    await row.getByRole("link", { name: "scratch_kv" }).click()
    await expect(page).toHaveURL(/\/kv\/scratch_kv$/)
  } finally {
    await page.request.delete("/api/streams/KV_scratch_kv", { data: { confirm: "KV_scratch_kv" } })
  }
})

test("Read-only mode disables New bucket", async ({ page }) => {
  await page.request.put("/api/contexts/active", { data: { source: "cli", name: "app" } })
  const settings = "/api/contexts/cli/app/settings"
  await page.request.put(settings, { data: { readOnly: true } })
  try {
    await page.goto("/kv")
    await expect(page.getByRole("button", { name: "New bucket" })).toBeDisabled()
  } finally {
    await page.request.put(settings, { data: {} })
  }
})
