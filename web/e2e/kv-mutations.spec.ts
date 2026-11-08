import { expect, test } from "@playwright/test"

// Works on keys of its own: sessions' clock and blink are rewritten by the seed.
test("put, delete and purge a key, and Read-only blocks all three", async ({ page }) => {
  await page.request.put("/api/contexts/active", { data: { source: "cli", name: "app" } })
  const settings = "/api/contexts/cli/app/settings"
  await page.goto("/kv/sessions")
  const keys = page.getByRole("region", { name: "Keys" })
  const key = (k: string) => keys.getByRole("button", { name: k, exact: true })

  await page.getByRole("button", { name: "Put key" }).click()
  const dialog = page.getByRole("dialog", { name: /Put a value in sessions/ })
  await dialog.getByLabel("Key", { exact: true }).fill("e2e.note")
  await dialog.getByLabel("Value").fill("hello")
  await expect(dialog.getByRole("button", { name: /Copy as CLI: nats kv put sessions e2e\.note hello/ })).toBeVisible()
  await dialog.getByRole("button", { name: "Put", exact: true }).click()
  await key("e2e.note").click() // appears without a reload
  const detail = page.getByRole("region", { name: "Key e2e.note" })
  await expect(detail.getByRole("list", { name: "Payload as text" })).toHaveText("hello")

  await detail.getByRole("button", { name: "Put value" }).click()
  await page.getByRole("dialog").getByLabel("Value").fill("again")
  await page.getByRole("dialog").getByRole("button", { name: "Put", exact: true }).click()
  await expect(detail.getByRole("list", { name: "Payload as text" })).toHaveText("again")
  await expect(detail.getByRole("list", { name: "Revisions" }).getByRole("listitem")).toHaveCount(2)

  await detail.getByRole("button", { name: "Delete", exact: true }).click()
  await expect(key("e2e.note")).toHaveCount(0)
  await expect(detail.getByText("This key has been deleted")).toBeVisible()

  // Purge needs the key back, and a confirmation.
  await page.request.put("/api/kv/sessions/keys/e2e.note", { data: "x" })
  await expect(key("e2e.note")).toBeVisible()
  await page.request.put(settings, { data: { readOnly: true } })
  try {
    await page.reload()
    await expect(page.getByRole("button", { name: "Put key" })).toBeDisabled()
    await key("e2e.note").click()
    for (const name of ["Put value", "Delete", "Purge…"]) await expect(detail.getByRole("button", { name, exact: true })).toBeDisabled()
  } finally {
    await page.request.put(settings, { data: {} })
  }
  await page.reload()
  await key("e2e.note").click()
  await detail.getByRole("button", { name: "Purge…" }).click()
  const confirm = page.getByRole("dialog", { name: "Purge e2e.note" })
  await expect(confirm.getByRole("button", { name: /Copy as CLI: nats kv purge sessions e2e\.note --force/ })).toBeVisible()
  await confirm.getByRole("button", { name: "Purge key" }).click()
  await expect(key("e2e.note")).toHaveCount(0)
})
