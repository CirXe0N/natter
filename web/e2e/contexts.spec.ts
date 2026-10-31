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

// Runs after the test above, in the same worker: both switch the backend's active Context.
test("create the Vault and a Context whose password lives in it, then connect", async ({ page, request }) => {
  const contexts: { name: string; urls: string }[] = await (await request.get("/api/contexts")).json()
  const natsURL = contexts.find((c) => c.name === "app")!.urls
  await page.goto("/contexts")
  const vault = page.getByRole("region", { name: "Vault" })

  await vault.getByLabel("Passphrase", { exact: true }).fill("correct horse battery")
  await vault.getByLabel("Repeat passphrase").fill("correct horse")
  await expect(vault.getByRole("button", { name: "Create Vault" })).toBeDisabled()
  await vault.getByLabel("Repeat passphrase").fill("correct horse battery")
  await vault.getByRole("button", { name: "Create Vault" }).click()
  await expect(page.getByText("Vault unlocked")).toBeVisible()

  await page.getByText("New Context").click()
  await page.getByLabel("Name").fill("vaulted")
  await page.getByLabel("Server URLs").fill(natsURL)
  await page.getByLabel("User").fill("app")
  await page.getByLabel("Secret").selectOption("password")
  await page.getByLabel("Password", { exact: true }).fill("app")
  await page.getByRole("button", { name: "Create Context" }).click()

  const card = page.getByRole("listitem", { name: "vaulted" })
  await expect(card.getByText("Vault", { exact: true })).toBeVisible()
  await expect(card.getByText("Natter Context")).toBeVisible()
  await card.getByRole("button", { name: "Connect" }).click()
  await expect(page.getByRole("banner").getByText("Connected")).toBeVisible()
})

// Runs after the Vault test: the Vault exists and is unlocked.
test("a secret can be an env:// reference, and a Plaintext secret can move into the Vault", async ({ page, request }) => {
  const contexts: { name: string; urls: string }[] = await (await request.get("/api/contexts")).json()
  const natsURL = contexts.find((c) => c.name === "app")!.urls
  await page.goto("/contexts")

  await page.getByText("New Context").click()
  await page.getByLabel("Name").fill("by-env")
  await page.getByLabel("Server URLs").fill(natsURL)
  await page.getByLabel("User").fill("app")
  await page.getByLabel("Secret").selectOption("password")
  await expect(page.getByLabel("Stored in").getByRole("option", { name: /nsc/ })).toHaveCount(0) // nsc gives creds
  await page.getByLabel("Stored in").selectOption({ label: "Environment variable (env://)" })
  await page.getByLabel("Reference").fill("env://E2E_APP_PASSWORD")
  await page.getByLabel("Also usable by the nats CLI").check()
  await page.getByRole("button", { name: "Create Context" }).click()
  const byEnv = page.getByRole("listitem", { name: "by-env" })
  await expect(byEnv.getByText("nats CLI Context")).toBeVisible()
  await byEnv.getByRole("button", { name: "Connect" }).click()
  await expect(page.getByRole("banner").getByText("Connected")).toBeVisible()

  const sys = page.getByRole("listitem", { name: "sys" }).filter({ hasText: "nats CLI Context" })
  await sys.getByRole("button", { name: "Move into Vault" }).click()
  await expect(sys.getByRole("status")).toContainText("The nats CLI file is unchanged")
  await expect(sys.getByText("Plaintext secret", { exact: true })).toBeVisible() // still flagged until the user deletes it
  const moved = page.getByRole("listitem", { name: "sys" }).filter({ hasText: "Natter Context" })
  await expect(moved.getByText("Vault", { exact: true })).toBeVisible()

  // Under Read-only (by-env is the active Context) the delete button stays, cannot act, and says why.
  await byEnv.getByRole("button", { name: "Read-only: off" }).click()
  const del = sys.getByRole("button", { name: "Delete the nats CLI file…" })
  await expect(del).toHaveAttribute("aria-disabled", "true")
  await expect(del).toHaveAccessibleDescription(/Read-only mode is on for this Context/)
  await del.focus()
  await expect(del).toBeFocused()
  await del.click({ force: true })
  await expect(sys.getByRole("button", { name: "Keep it" })).toHaveCount(0)
  await expect(page.getByLabel("Also usable by the nats CLI")).toBeDisabled()
  await byEnv.getByRole("button", { name: "Read-only: on" }).click()

  await del.click()
  await sys.getByRole("button", { name: "Keep it" }).click() // the file is shared with other specs, so it stays
  await expect(sys.getByRole("button", { name: "Delete the nats CLI file…" })).toBeVisible()
})

// Runs after the Vault test: the Vault is unlocked with "correct horse battery".
test("change the Vault passphrase, then unlock with the new one", async ({ page, request }) => {
  await page.goto("/contexts")
  await page.getByRole("button", { name: "Change passphrase" }).click()
  const form = page.getByRole("form", { name: "Vault passphrase" })

  await form.getByLabel("Current passphrase").fill("not it")
  await form.getByLabel("New passphrase", { exact: true }).fill("battery staple")
  await form.getByLabel("Repeat new passphrase").fill("battery staple")
  await form.getByRole("button", { name: "Save passphrase" }).click()
  await expect(form.getByRole("alert")).toContainText("wrong passphrase")

  await form.getByLabel("Current passphrase").fill("correct horse battery")
  await form.getByRole("button", { name: "Save passphrase" }).click()
  await expect(form).toBeHidden()

  expect((await request.post("/api/vault/unlock", { data: { passphrase: "correct horse battery" } })).status()).toBe(400)
  const unlocked = await request.post("/api/vault/unlock", { data: { passphrase: "battery staple" } })
  expect(unlocked.status()).toBe(200)
  expect(await unlocked.json()).toMatchObject({ state: "unlocked", hasPassphrase: true })
})
