import { expect, test } from "@playwright/test"

test("Chromium reads the PWA manifest and its icons through the session", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "reads the manifest over CDP")
  await page.goto("/")
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible()
  const cdp = await page.context().newCDPSession(page)
  await expect(async () => {
    const m = await cdp.send("Page.getAppManifest")
    expect(m.errors).toEqual([])
    expect(JSON.parse(m.data ?? "{}").name).toBe("Natter")
  }).toPass()
  // Includes fetching the 192 and 512 px icons, which also need the session.
  const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors")
  expect(installabilityErrors).toEqual([])
})
