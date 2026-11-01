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
  await expect(card("app").getByText("JetStream", { exact: true })).toBeVisible()
  await expect(card("app").getByText("No system access")).toBeVisible()
  await expect(card("app").getByText("Active")).toBeVisible()

  await card("app").getByRole("link", { name: "Edit" }).click()
  await expect(page).toHaveURL(/\/contexts\/cli\/app\/edit$/)
  await expect(page.getByLabel("Name")).toHaveValue("app")
  await page.getByLabel("Monitoring URL").fill(process.env.E2E_MONITORING!)
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(page).toHaveURL(/\/contexts$/)
  await expect(card("app").getByText("Monitoring URL", { exact: true })).toBeVisible()
  await expect(card("app").getByText("No system access")).toHaveCount(0)

  await card("app").getByRole("button", { name: "Writable" }).click()
  await expect(card("app").getByRole("button", { name: "Read-only" })).toBeVisible()
  const badge = topBar.getByRole("button", { name: "Read-only" })
  expect((await badge.boundingBox())!.height).toBeGreaterThanOrEqual(24)
  await badge.click() // the badge unlocks
  await expect(card("app").getByRole("button", { name: "Writable" })).toBeVisible()
  await expect(topBar.getByRole("button", { name: "Read-only" })).toHaveCount(0)
  await expect(topBar.getByRole("button", { name: "Writable" })).toBeVisible()

  const switcher = page.getByRole("button", { name: /Switch Context/ })
  await switcher.click()
  await page.getByRole("menuitemradio", { name: "sys" }).click()
  await expect(switcher).toHaveAccessibleName("Context: sys. Switch Context")
  await expect(card("sys").getByText("System credentials", { exact: true })).toBeVisible()
  await expect(card("sys").getByText("No JetStream")).toBeVisible()

  await switcher.click()
  await page.getByRole("menuitemradio", { name: /wrong-password/ }).click()
  await expect(topBar.getByRole("alert")).toContainText(/authorization violation/i)

  await page.reload() // the active Context is the backend's, not the tab's
  await expect(switcher).toHaveAccessibleName("Context: wrong-password. Switch Context")
})

// Runs after the test above, in the same worker: both switch the backend's active Context.
// The e2e server has a keyring, as on a desktop, so the first Vault secret creates the Vault.
test("the first Vault secret creates the Vault in the keyring, then a backup passphrase is added", async ({ page, request }) => {
  const contexts: { name: string; urls: string }[] = await (await request.get("/api/contexts")).json()
  const natsURL = contexts.find((c) => c.name === "app")!.urls
  await page.goto("/contexts")
  const vault = page.getByRole("region", { name: "Vault" })
  await expect(vault).toContainText("No Vault yet")

  await page.getByRole("link", { name: "New Context" }).click()
  await page.getByLabel("Name").fill("vaulted")
  await page.getByLabel("Server URLs").fill(natsURL)
  await page.getByLabel("User").fill("app")
  await page.getByRole("group", { name: "Secret" }).getByRole("button", { name: "Password" }).click()
  await expect(page.getByRole("group", { name: "Stored in" }).getByRole("button", { name: "Vault" })).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByRole("radio", { name: /nats CLI/ })).toBeDisabled() // natscli cannot read the Vault
  await expect(page.getByText("Saving creates the Vault, with its key in your OS keyring.")).toBeVisible()
  await page.getByLabel("Password", { exact: true }).fill("app")
  await page.getByRole("button", { name: "Create Context" }).click()
  await expect(page).toHaveURL(/\/contexts$/)

  const card = page.getByRole("listitem", { name: "vaulted" })
  await expect(card.getByText("Vault", { exact: true })).toBeVisible()
  await expect(card.getByText("Natter Context")).toBeVisible()
  await expect(page.getByText("Vault unlocked")).toBeVisible()
  await expect(page.getByRole("button", { name: "OS keyring: on" })).toBeVisible()
  await card.getByRole("button", { name: "Connect" }).click()
  await expect(page.getByRole("banner").getByText("Connected")).toBeVisible()

  // The keyring holds the only copy of the key until there is a passphrase.
  await expect(page.getByText("The Vault key is only in your OS keyring.")).toBeVisible()
  await page.getByRole("button", { name: "OS keyring: on" }).click()
  await expect(page.getByRole("alert")).toContainText("add a passphrase first")
  await page.getByRole("button", { name: "Add a backup passphrase" }).click()
  const form = page.getByRole("form", { name: "Vault passphrase" })
  await form.getByLabel("New passphrase", { exact: true }).fill("correct horse battery")
  await form.getByLabel("Repeat new passphrase").fill("correct horse")
  await expect(form.getByRole("button", { name: "Save passphrase" })).toBeDisabled()
  await form.getByLabel("Repeat new passphrase").fill("correct horse battery")
  await form.getByRole("button", { name: "Save passphrase" }).click()
  await expect(form).toBeHidden()
  await expect(page.getByText("The Vault key is only in your OS keyring.")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Change passphrase" })).toBeVisible()
})

// Runs after the Vault test: the Vault exists and is unlocked.
test("a secret can be an env:// reference, and a Plaintext secret can move into the Vault", async ({ page, request }) => {
  const contexts: { name: string; urls: string }[] = await (await request.get("/api/contexts")).json()
  const natsURL = contexts.find((c) => c.name === "app")!.urls
  await page.goto("/contexts")

  await page.getByRole("link", { name: "Add Context" }).click()
  await page.getByLabel("Name").fill("by-env")
  await page.getByLabel("Server URLs").fill(natsURL)
  await page.getByLabel("User").fill("app")
  await page.getByRole("group", { name: "Secret" }).getByRole("button", { name: "Password" }).click()
  const storedIn = page.getByRole("group", { name: "Stored in" })
  await expect(storedIn.getByRole("button", { name: "nsc" })).toHaveCount(0) // nsc gives creds
  await storedIn.getByRole("button", { name: "env://" }).click()
  await page.getByLabel("Reference").fill("env://E2E_APP_PASSWORD")
  await page.getByRole("radio", { name: /nats CLI/ }).check()
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
  await byEnv.getByRole("button", { name: "Writable" }).click()
  const del = sys.getByRole("button", { name: "Delete the nats CLI file…" })
  await expect(del).toHaveAttribute("aria-disabled", "true")
  await expect(del).toHaveAccessibleDescription(/Read-only mode is on for this Context/)
  await del.focus()
  await expect(del).toBeFocused()
  await del.click({ force: true })
  await expect(sys.getByRole("button", { name: "Keep it" })).toHaveCount(0)
  await expect(byEnv.getByRole("button", { name: "Remove" })).toHaveAccessibleDescription(/Connect to another Context/)
  await expect(sys.getByRole("button", { name: "Remove" })).toHaveAccessibleDescription(/Read-only mode is on/)
  await byEnv.getByRole("button", { name: "Read-only" }).click()

  await del.click()
  await sys.getByRole("button", { name: "Keep it" }).click() // the file is shared with other specs, so it stays
  await expect(sys.getByRole("button", { name: "Delete the nats CLI file…" })).toBeVisible()

  // Read-only also keeps a new Context out of natscli's directory.
  await byEnv.getByRole("button", { name: "Writable" }).click()
  await page.getByRole("link", { name: "New Context" }).click()
  await expect(page.getByRole("radio", { name: /nats CLI/ })).toBeDisabled()
  await page.getByRole("link", { name: "Cancel" }).click()
  await byEnv.getByRole("button", { name: "Read-only" }).click()
  await expect(byEnv.getByRole("button", { name: "Writable" })).toBeVisible()
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

// Runs after the Vault test: the Vault is unlocked and "vaulted" holds a Vault password.
test("edit a Context, change its secret, and remove another", async ({ page, request }) => {
  const contexts: { name: string; urls: string }[] = await (await request.get("/api/contexts")).json()
  const natsURL = contexts.find((c) => c.name === "app")!.urls
  await page.goto("/contexts")
  const card = (name: string) => page.getByRole("listitem", { name })

  await card("vaulted").getByRole("link", { name: "Edit" }).click()
  await expect(page.getByRole("navigation", { name: "Breadcrumb" }).locator("[aria-current=page]")).toHaveText("vaulted")
  await expect(page.getByLabel("Name")).toHaveAttribute("readonly", "")
  await expect(page.getByRole("form").getByText("Password", { exact: true })).toBeVisible() // the kept secret
  await page.getByLabel("Description").fill("edited in Natter")
  await page.getByRole("button", { name: "Change secret" }).click()
  await page.getByRole("group", { name: "Stored in" }).getByRole("button", { name: "env://" }).click()
  await page.getByLabel("Reference").fill("env://E2E_APP_PASSWORD")
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(card("vaulted").getByText("edited in Natter")).toBeVisible()
  await expect(card("vaulted").getByText("Env (env://)")).toBeVisible()
  await card("vaulted").getByRole("button", { name: "Connect" }).click()
  await expect(page.getByRole("banner").getByText("Connected")).toBeVisible()

  await page.getByRole("link", { name: "New Context" }).click()
  await page.getByLabel("Name").fill("scratch")
  await page.getByLabel("Server URLs").fill(natsURL)
  await page.getByRole("button", { name: "Create Context" }).click()
  await card("scratch").getByRole("button", { name: "Remove" }).click()
  const dialog = page.getByRole("dialog", { name: "Remove scratch?" })
  await expect(dialog).toContainText("~/.config/natter/nats/context/scratch.json")
  await dialog.getByRole("button", { name: "Remove Context" }).click()
  await expect(dialog).toBeHidden()
  await expect(card("scratch")).toHaveCount(0)
})
