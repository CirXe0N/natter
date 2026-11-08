import { expect, test } from "@playwright/test"

test.beforeEach(async ({ page }) => {
  await page.request.put("/api/contexts/active", { data: { source: "cli", name: "app" } })
  await page.goto("/publish")
})

test("a request shows its reply, and no responders, a timeout and a refusal read differently", async ({ page }) => {
  const subject = page.getByLabel("Subject")
  await page.getByRole("button", { name: "Request", exact: true }).click()
  await subject.fill("e2e.echo")
  await page.getByLabel("Payload", { exact: true }).fill('{"hello":1}')
  await expect(page.getByText("Valid JSON", { exact: true })).toBeVisible()
  await page.getByRole("tab", { name: /Headers/ }).click()
  await page.getByRole("button", { name: "Add header" }).click()
  await page.getByLabel("Header 1 name").fill("X-Test")
  await page.getByLabel("Header 1 value").fill("1")
  await page.getByRole("button", { name: "Send request" }).click()
  const result = page.getByRole("region", { name: "Result" })
  await expect(result).toContainText("reply")
  await expect(result.getByLabel("Reply payload")).toContainText('echo:{"hello":1}')

  await subject.fill("e2e.nobody")
  await subject.press("Control+Enter") // the keyboard shortcut sends too
  await expect(result).toContainText("No responders")

  await subject.fill("e2e.silent") // subscribed, never replies
  await page.getByRole("tab", { name: /Timeout/ }).click()
  await page.getByLabel("Timeout (ms)").fill("200")
  await page.getByRole("button", { name: "Send request" }).click()
  await expect(result).toContainText("Timed out after 200 ms")

  await subject.fill("a.>")
  await page.getByRole("button", { name: "Send request" }).click()
  await expect(result).toContainText("Refused")
  await expect(result.getByRole("alert")).toContainText("literal subject")

  await page.getByRole("tab", { name: /History/ }).click()
  await expect(page.getByRole("list", { name: "History" }).getByRole("listitem")).toHaveCount(4)
})

test("a payload over max_payload is refused before sending, and Read-only blocks every send", async ({ page }) => {
  await page.getByLabel("Subject").fill("e2e.big")
  const max = (await (await page.request.get("/api/contexts/active")).json()).maxPayload as number
  await page.getByLabel("Payload", { exact: true }).fill("x".repeat(max + 1))
  await expect(page.getByRole("alert").filter({ hasText: "Too large" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Publish message" })).toBeDisabled()

  await page.getByLabel("Payload", { exact: true }).fill("ok")
  await expect(page.getByRole("button", { name: "Publish message" })).toBeEnabled()
  await page.request.put("/api/contexts/cli/app/settings", { data: { readOnly: true } })
  try {
    await page.reload()
    await page.getByLabel("Subject").fill("e2e.ro")
    for (const name of ["Publish message", "Send request"]) {
      if (name === "Send request") await page.getByRole("button", { name: "Request", exact: true }).click()
      const send = page.getByRole("button", { name })
      await expect(send).toHaveAttribute("aria-disabled", "true")
      await expect(send).toHaveAccessibleDescription(/Read-only mode is on/)
    }
    await page.getByRole("button", { name: "Switch to Writable" }).click()
    await expect(page.getByRole("button", { name: "Send request" })).toBeEnabled()
  } finally {
    await page.request.put("/api/contexts/cli/app/settings", { data: {} })
  }
})

test("placeholders insert at the cursor, preview from the server, a bad one is flagged, and a count sends many", async ({ page }) => {
  await page.getByRole("button", { name: "Request", exact: true }).click()
  await page.getByLabel("Subject").fill("e2e.echo")
  await page.getByLabel("Payload", { exact: true }).fill("n=")
  await page.getByRole("button", { name: "{{Count}}" }).click()
  await page.getByRole("button", { name: "Preview next send" }).click()
  const preview = page.getByRole("region", { name: "Preview" })
  await expect(preview.getByLabel("Preview payload")).toHaveText("n=1")
  await page.getByRole("button", { name: "Back to editing" }).click()

  await page.getByLabel("Payload", { exact: true }).fill("n={{Bogus}}")
  await expect(page.getByRole("alert").filter({ hasText: "Unknown or broken placeholder" })).toBeVisible()

  await page.getByLabel("Payload", { exact: true }).fill("n={{Count}}")
  await page.getByRole("tab", { name: /Timeout/ }).click()
  await page.getByLabel("Count", { exact: true }).fill("3")
  await page.getByRole("button", { name: "Send 3 requests" }).click()
  const result = page.getByRole("region", { name: "Result" })
  await expect(result).toContainText("3 of 3 sent")
  await expect(result.getByLabel("Reply payload")).toContainText("echo:n=3")
})
