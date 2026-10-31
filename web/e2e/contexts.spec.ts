import { expect, test } from "@playwright/test"

// One flow, because the active Context is server state shared by every step.
test("connect to CLI Contexts, see their capabilities, and switch from the sidebar", async ({ page }) => {
  await page.goto("/contexts")
  const card = (name: string) => page.getByRole("listitem", { name })
  const topBar = page.getByRole("banner")

  await expect(card("app").getByText("Env (env://)")).toBeVisible()
  await expect(card("sys").getByText("Plaintext secret", { exact: true })).toBeVisible()
  await expect(card("wrong-password").getByText("Plaintext secret", { exact: true })).toBeVisible()
  await expect(card("app").getByText("Plaintext secret", { exact: true })).toHaveCount(0)

  await card("app").getByRole("button", { name: "Connect" }).click()
  await expect(topBar.getByText("Connected")).toBeVisible()
  await expect(topBar.getByText("JetStream", { exact: true })).toBeVisible()
  await expect(topBar.getByText("No system access")).toBeVisible()
  await expect(card("app").getByText("Active")).toBeVisible()

  await card("app").getByText("Monitoring URL: not set").click()
  await card("app").getByLabel("Monitoring URL for app").fill(process.env.E2E_MONITORING!)
  await card("app").getByRole("button", { name: "Save" }).click()
  await expect(topBar.getByText("Monitoring URL", { exact: true })).toBeVisible()
  await expect(topBar.getByText("No system access")).toHaveCount(0)

  await card("app").getByRole("button", { name: "Read-only: off" }).click()
  await expect(card("app").getByRole("button", { name: "Read-only: on" })).toBeVisible()
  const badge = topBar.getByRole("button", { name: "Read-only" })
  expect((await badge.boundingBox())!.height).toBeGreaterThanOrEqual(24)
  await badge.click() // the badge unlocks
  await expect(card("app").getByRole("button", { name: "Read-only: off" })).toBeVisible()
  await expect(topBar.getByRole("button", { name: "Read-only" })).toHaveCount(0)

  const switcher = page.getByRole("button", { name: /Switch Context/ })
  await switcher.click()
  await page.getByRole("menuitemradio", { name: "sys" }).click()
  await expect(switcher).toHaveAccessibleName("Context: sys. Switch Context")
  await expect(topBar.getByText("System credentials")).toBeVisible()
  await expect(topBar.getByText("No JetStream")).toBeVisible()

  await switcher.click()
  await page.getByRole("menuitemradio", { name: /wrong-password/ }).click()
  await expect(topBar.getByRole("alert")).toContainText(/authorization violation/i)

  await page.reload() // the active Context is the backend's, not the tab's
  await expect(switcher).toHaveAccessibleName("Context: wrong-password. Switch Context")
})
