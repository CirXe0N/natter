import { expect, test, type Page } from "@playwright/test"

test.beforeEach(async ({ page }) => {
  await page.request.put("/api/contexts/active", { data: { source: "cli", name: "app" } })
  const all = (await (await page.request.get("/api/examples")).json()) as { id: string }[]
  for (const e of all) await page.request.delete(`/api/examples/${e.id}`)
  await page.goto("/publish")
})

// The Examples picker, opened.
async function picker(page: Page) {
  await page.getByRole("button", { name: /^Examples/ }).click()
  return page.getByRole("dialog", { name: "Example messages" })
}

test("save, load, resend, rename and move, copy with a conflict, and delete an Example message", async ({ page }) => {
  await page.getByRole("button", { name: "Request", exact: true }).click()
  await page.getByLabel("Subject").fill("e2e.echo")
  await page.getByLabel("Payload", { exact: true }).fill("{{id}}")
  await page.getByLabel("Name", { exact: true }).fill("echo")
  await page.getByLabel("Folder", { exact: true }).fill("smoke")
  await expect(page.getByText("not saved yet")).toBeVisible()
  await page.getByRole("button", { name: "Save", exact: true }).click()
  await expect(page.getByText("not saved yet")).toHaveCount(0)
  await expect((await picker(page)).getByRole("group", { name: "smoke" })).toContainText("echo")
  await page.keyboard.press("Escape")

  await page.getByLabel("Subject").fill("changed")
  await expect(page.getByText("unsaved changes")).toBeVisible()
  await (await picker(page)).getByRole("button", { name: "Load echo" }).click()
  await page.getByRole("button", { name: "Discard" }).click()
  await expect(page.getByLabel("Subject")).toHaveValue("e2e.echo")

  await page.getByRole("button", { name: "Send request" }).click()
  await expect(page.getByRole("region", { name: "Result" }).getByLabel("Reply payload")).toContainText("echo:{{id}}") // stored unrendered

  await page.getByLabel("Name", { exact: true }).fill("echo2")
  await page.getByLabel("Folder", { exact: true }).fill("")
  await page.getByRole("button", { name: "Save", exact: true }).click()
  await expect((await picker(page)).getByRole("group", { name: "No folder" })).toContainText("echo2")
  await page.keyboard.press("Escape")

  const copy = page.getByRole("dialog", { name: /Copy examples from/ })
  await page.getByRole("button", { name: "Copy to…" }).click()
  await copy.getByRole("button", { name: /^sys/ }).click()
  await expect(copy.getByRole("group", { name: "Name conflicts" })).toHaveCount(0)
  await copy.getByRole("button", { name: "Copy 1 to sys" }).click()
  await expect(copy).toHaveCount(0)
  await page.getByRole("button", { name: "Copy to…" }).click()
  await copy.getByRole("button", { name: /^sys/ }).click()
  await expect(copy.getByRole("group", { name: "Name conflicts" })).toBeVisible() // now it conflicts
  await copy.getByRole("button", { name: "Keep both" }).click()
  await copy.getByRole("button", { name: "Copy 1 to sys" }).click()
  await expect(copy).toHaveCount(0)
  const onSys = ((await (await page.request.get("/api/examples")).json()) as { context: string; name: string }[]).filter((e) => e.context === "sys").map((e) => e.name)
  expect(onSys.sort()).toEqual(["echo2", "echo2 (copy)"])

  await page.getByRole("button", { name: "Delete example" }).click()
  await page.getByRole("button", { name: "Delete", exact: true }).click()
  await expect((await picker(page)).getByText("No examples in app yet")).toBeVisible()
})

test("under Read-only mode Examples can be saved and edited but not sent", async ({ page }) => {
  await page.getByLabel("Subject").fill("e2e.ro")
  await page.getByLabel("Name", { exact: true }).fill("ro")
  await page.getByRole("button", { name: "Save", exact: true }).click()
  await expect(page.getByText("not saved yet")).toHaveCount(0)
  await page.request.put("/api/contexts/cli/app/settings", { data: { readOnly: true } })
  try {
    await page.reload()
    await (await picker(page)).getByRole("button", { name: "Load ro" }).click()
    await expect(page.getByRole("button", { name: "Publish message" })).toHaveAttribute("aria-disabled", "true")
    await page.getByLabel("Name", { exact: true }).fill("ro2")
    await page.getByRole("button", { name: "Save", exact: true }).click()
    await expect((await picker(page)).getByRole("button", { name: "Load ro2" })).toBeVisible()
  } finally {
    await page.request.put("/api/contexts/cli/app/settings", { data: {} })
  }
})
