import { expect, test } from "@playwright/test"

test("the shell opens on Overview and navigates between empty screens", async ({ page }) => {
  await page.goto("/")
  await expect(page).toHaveURL(/\/overview$/)
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible()
  await expect(page.getByText("Natter e2e")).toBeVisible() // /api/info answered with the session cookie

  const nav = page.getByRole("navigation", { name: "Screens" })
  await nav.getByRole("link", { name: "Streams" }).click()
  await expect(page).toHaveURL(/\/streams$/)
  await expect(page.getByRole("heading", { level: 1, name: "Streams" })).toBeVisible()
  await expect(nav.getByRole("link", { name: "Streams" })).toHaveAttribute("aria-current", "page")
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toHaveText("Streams")
  await expect(page).toHaveTitle("Streams · Natter")

  await page.goBack()
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible()
})

test.describe("without a session", () => {
  test.use({ storageState: { cookies: [], origins: [] } })
  test("the shell is not served", async ({ page }) => {
    const res = await page.goto("/overview")
    expect(res?.status()).toBe(401)
    await expect(page.getByRole("navigation", { name: "Screens" })).toHaveCount(0)
  })
})

test("density changes row height, persists, and keeps controls at least 24 px", async ({ page }) => {
  await page.goto("/overview")
  const row = page.getByRole("navigation", { name: "Screens" }).getByRole("link", { name: "Streams" })
  const height = async () => (await row.boundingBox())!.height

  expect(await height()).toBe(32)
  await page.getByRole("button", { name: "Compact" }).click()
  expect(await height()).toBe(28)
  await page.reload()
  expect(await height()).toBe(28)
  await expect(page.getByRole("button", { name: "Compact" })).toHaveAttribute("aria-pressed", "true")
  await page.getByRole("button", { name: "Comfortable" }).click()
  expect(await height()).toBe(36)

  for (const name of ["Compact", "Default", "Comfortable"]) {
    const box = (await page.getByRole("button", { name }).boundingBox())!
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(24)
  }
})

test("keyboard focus draws a 2 px outline", async ({ page }) => {
  await page.goto("/overview")
  const outline = () =>
    page.evaluate(() => {
      const s = getComputedStyle(document.activeElement!)
      return `${s.outlineStyle} ${s.outlineWidth}`
    })
  const context = page.getByRole("button", { name: /Switch Context/ })
  for (let i = 0; i < 3 && !(await context.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab")
  await expect(context).toBeFocused()
  expect(await outline()).toBe("solid 2px")

  await page.keyboard.press("Tab")
  await expect(page.getByRole("link", { name: "Overview" })).toBeFocused()
  expect(await outline()).toBe("solid 2px")

  await page.getByRole("button", { name: "Default" }).focus()
  await page.keyboard.press("ArrowLeft")
  await expect(page.getByRole("button", { name: "Compact" })).toBeFocused()
  expect(await outline()).toBe("solid 2px")
})

test("Inter Variable and Geist Mono load from the binary", async ({ page }) => {
  await page.goto("/overview")
  const loaded = await page.evaluate(async () => {
    const [sans, mono] = await Promise.all([document.fonts.load('13px "Inter Variable"'), document.fonts.load('13px "Geist Mono Variable"')])
    return { sans: sans.length, mono: mono.length, urls: performance.getEntriesByType("resource").map((e) => e.name).filter((n) => n.endsWith(".woff2")) }
  })
  expect(loaded.sans).toBeGreaterThan(0)
  expect(loaded.mono).toBeGreaterThan(0)
  expect(loaded.urls.length).toBeGreaterThan(0)
  for (const url of loaded.urls) expect(url.startsWith(`${process.env.E2E_URL}/assets/`)).toBe(true)
})
