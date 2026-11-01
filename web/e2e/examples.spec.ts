import { expect, test } from "@playwright/test"

test.beforeEach(async ({ page }) => {
  await page.request.put("/api/contexts/active", { data: { source: "cli", name: "app" } })
  const all = (await (await page.request.get("/api/examples")).json()) as { id: string }[]
  for (const e of all) await page.request.delete(`/api/examples/${e.id}`)
  await page.goto("/publish")
})

test("save, resend, rename and move, copy with a conflict, and delete an Example message", async ({ page }) => {
  await page.getByRole("button", { name: "Request", exact: true }).click()
  await page.getByLabel("Subject").fill("e2e.echo")
  await page.getByLabel("Payload", { exact: true }).fill("{{id}}")
  const panel = page.getByRole("region", { name: "Example messages" })
  await panel.getByLabel("Name", { exact: true }).fill("echo")
  await panel.getByLabel("Folder", { exact: true }).fill("smoke")
  await panel.getByRole("button", { name: "Save as Example" }).click()
  await expect(panel.getByRole("group", { name: "smoke" })).toContainText("echo")

  await page.getByLabel("Subject").fill("changed")
  await panel.getByRole("button", { name: "Load echo" }).click()
  await expect(page.getByLabel("Subject")).toHaveValue("e2e.echo")

  await panel.getByRole("button", { name: "Resend echo" }).click()
  await expect(page.getByRole("region", { name: "Result" }).getByLabel("Reply payload")).toContainText("echo:{{id}}") // stored unrendered

  await panel.getByRole("button", { name: "Rename or move echo" }).click()
  await panel.getByLabel("Name", { exact: true }).last().fill("echo2")
  await panel.getByLabel("Folder", { exact: true }).last().fill("")
  await panel.getByRole("button", { name: "Save", exact: true }).click()
  await expect(panel.getByRole("group", { name: "No folder" })).toContainText("echo2")

  await panel.getByLabel("Copy echo2 to").selectOption("sys")
  await expect(panel.getByRole("group", { name: "Name conflicts" })).toHaveCount(0)
  await panel.getByLabel("Copy echo2 to").selectOption("sys") // now it conflicts
  const conflict = panel.getByRole("group", { name: "Name conflicts" })
  await expect(conflict).toBeVisible()
  await expect(conflict.getByRole("button", { name: "Copy", exact: true })).toBeDisabled()
  await conflict.getByLabel("Conflict: echo2").selectOption("keep")
  await conflict.getByRole("button", { name: "Copy", exact: true }).click()
  const onSys = ((await (await page.request.get("/api/examples")).json()) as { context: string; name: string }[]).filter((e) => e.context === "sys").map((e) => e.name)
  expect(onSys.sort()).toEqual(["echo2", "echo2 (copy)"])

  await panel.getByRole("button", { name: "Delete echo2" }).click()
  await expect(panel.getByText("No Example messages saved")).toBeVisible()
})

test("under Read-only mode Examples can be saved and edited but not resent", async ({ page }) => {
  await page.getByLabel("Subject").fill("e2e.ro")
  const panel = page.getByRole("region", { name: "Example messages" })
  await panel.getByLabel("Name", { exact: true }).fill("ro")
  await panel.getByRole("button", { name: "Save as Example" }).click()
  await page.request.put("/api/contexts/cli/app/settings", { data: { readOnly: true } })
  try {
    await page.reload()
    await expect(panel.getByRole("button", { name: "Resend ro" })).toHaveAttribute("aria-disabled", "true")
    await page.getByLabel("Subject").fill("e2e.ro")
    await panel.getByLabel("Name", { exact: true }).first().fill("ro2")
    await panel.getByRole("button", { name: "Save as Example" }).click()
    await expect(panel.getByRole("button", { name: "Load ro2" })).toBeVisible()
  } finally {
    await page.request.put("/api/contexts/cli/app/settings", { data: {} })
  }
})
