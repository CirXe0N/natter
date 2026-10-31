import { expect, test } from "@playwright/test"

test("the command palette switches Context, opens a stream, and returns focus", async ({ page }) => {
  await page.goto("/overview")
  const switcher = page.getByRole("button", { name: /Switch Context/ })
  const palette = page.getByRole("dialog", { name: "Command palette" })
  const input = palette.getByRole("combobox")

  // Switch Context from the keyboard alone.
  await page.getByRole("link", { name: "Overview" }).focus()
  await page.keyboard.press("Control+k")
  await expect(input).toBeFocused()
  await page.keyboard.type("use app")
  await expect(palette.getByRole("option", { name: /Use app/ })).toContainText("nats context select app")
  await page.keyboard.press("Enter")
  await expect(palette).toHaveCount(0)
  await expect(switcher).toHaveAccessibleName("Context: app. Switch Context")
  await expect(page.getByRole("banner").getByText("JetStream", { exact: true })).toBeVisible()
  await expect(page.getByRole("link", { name: "Overview" })).toBeFocused()

  // Streams and buckets come from the Context just activated.
  await page.keyboard.press("Control+k")
  await page.keyboard.type("orders")
  await expect(palette.getByRole("option", { name: /Open stream ORDERS/ })).toContainText("nats stream info ORDERS")
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(/\/streams$/)

  await page.keyboard.press("Control+k")
  await page.keyboard.type("config")
  await expect(palette.getByRole("option", { name: /Open bucket config/ })).toContainText("nats kv status config")
  await page.keyboard.press("Escape")
  await expect(palette).toHaveCount(0)

  // Natter's own Contexts are invisible to natscli, so they get no CLI hint; the description shows instead.
  const made = await page.request.post("/api/contexts", { data: { name: "palette-own", description: "made in Natter", urls: "nats://127.0.0.1:1" } })
  expect(made.ok(), await made.text()).toBe(true)
  await page.reload()
  await expect(switcher).toBeVisible() // the palette listens once the app has mounted
  await page.keyboard.press("Control+k")
  await page.keyboard.type("use palette-own")
  const own = palette.getByRole("option", { name: /Use palette-own/ })
  await expect(own).toContainText("made in Natter")
  await expect(own).not.toContainText("nats context select")
})
