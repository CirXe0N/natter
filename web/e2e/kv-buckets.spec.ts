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
})
