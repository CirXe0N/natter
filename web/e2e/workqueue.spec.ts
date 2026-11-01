import { expect, test, type Page } from "@playwright/test"

// JOBS (internal/e2eserver) is a WorkQueue stream of 250 messages with 120 deleted.
const activate = (page: Page) => page.request.put("/api/contexts/active", { data: { source: "cli", name: "app" } })
const rows = (page: Page) => page.getByRole("rowgroup", { name: "Message rows" })
const openRow = (page: Page, seq: number) => rows(page).getByRole("cell", { name: `#${seq}`, exact: true }).click()
const jobs = async (page: Page) => (await (await page.request.get("/api/streams/JOBS")).json()) as { msgs: number; consumers: number }

test("a WorkQueue stream is browsed with Direct Get: open, Prev and Next, delete, and nothing consumed", async ({ page }) => {
  await activate(page)
  const before = await jobs(page)
  await page.goto("/streams/JOBS/messages")
  await expect(page.getByRole("note")).toContainText("That transfers every listed payload")
  const status = page.getByRole("table", { name: "Messages" }).getByRole("status")
  await expect(status).toContainText(`of ${before.msgs}`)
  await expect(rows(page).getByRole("row").first().getByRole("cell").first()).toHaveText("#1")
  await expect(rows(page).getByRole("row").first()).toContainText('{"job":1}')
  expect((await jobs(page)).consumers).toBe(0)

  // Next reads on past the jump's page; Prev and Next step over the deleted 120.
  await page.getByLabel("Sequence", { exact: true }).fill("100")
  await page.getByRole("button", { name: "Jump to sequence" }).click()
  await expect(rows(page).getByRole("row").first()).toContainText("#100")
  await openRow(page, 100)
  const heading = page.getByRole("dialog").getByRole("heading")
  await page.getByRole("button", { name: "Next message" }).click()
  await expect(heading).toHaveText("Message #101")
  await expect(page.getByRole("dialog")).toContainText("job: 101")
  for (let seq = 102; seq <= 119; seq++) {
    await page.getByRole("button", { name: "Next message" }).click()
    await expect(heading).toHaveText(`Message #${seq}`)
  }
  await page.getByRole("button", { name: "Next message" }).click()
  await expect(heading).toHaveText("Message #121")
  await page.getByRole("button", { name: "Previous message" }).click()
  await expect(heading).toHaveText("Message #119")

  // Delete the first message after 121: the drawer moves on, and nothing else leaves the queue.
  await page.getByRole("button", { name: "Next message" }).click()
  await expect(heading).toHaveText("Message #121")
  await page.getByRole("button", { name: "Next message" }).click()
  await expect(heading).not.toHaveText("Message #121")
  const seq = Number((await heading.textContent())!.slice("Message #".length))
  await page.getByRole("dialog").getByRole("button", { name: "Delete…" }).click()
  await page.getByRole("dialog", { name: `Delete message #${seq}` }).getByRole("button", { name: "Delete message" }).click()
  await expect(heading).not.toHaveText(`Message #${seq}`)
  expect((await page.request.get(`/api/streams/JOBS/messages/${seq}`)).status()).toBe(404)
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click()
  await expect(status).toContainText(`of ${before.msgs - 1}`)
  expect((await jobs(page)).msgs).toBe(before.msgs - 1)
  expect((await jobs(page)).consumers).toBe(0)
})
