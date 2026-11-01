import { expect, test, type Page } from "@playwright/test"

import type { Overview, ServerFrame } from "../src/gen/api.ts"

const activate = (page: Page, name: string) => page.request.put("/api/contexts/active", { data: { source: "cli", name } })
const setMonitoringURL = (page: Page, name: string, monitoringUrl?: string) =>
  page.request.put(`/api/contexts/cli/${name}/settings`, { data: { monitoringUrl } })
const asOfTime = (page: Page) => page.locator("time").first() // the section bar's "as of"
const sparkline = (page: Page, label: string) =>
  page.locator("dl > div").filter({ has: page.locator("dt", { hasText: label }) }).locator("path")

test("live tiles and server health follow the active Context's access", async ({ page }) => {
  await setMonitoringURL(page, "app")
  await activate(page, "app")
  await page.goto("/overview")
  await expect(page.getByRole("status")).toHaveCount(1)
  await expect(page.getByRole("heading", { name: "Server stats are not available" })).toBeVisible()
  await expect(page.getByRole("main").getByText("Server stats need System credentials or a Monitoring URL. The Context app has neither.")).toBeVisible()

  await activate(page, "sys")
  await expect(page.getByText("All servers, via System credentials")).toBeVisible()
  const servers = page.getByRole("region", { name: "Servers", exact: true })
  await expect(servers.getByRole("heading")).toContainText("Servers")
  await expect(servers).toContainText("1 server")
  await expect(servers.getByRole("rowheader")).toHaveCount(1)
  await expect(page.getByRole("status")).toContainText("Server stats are available. 1 server answering")

  const msgsIn = sparkline(page, "Msgs in/s")
  const before = await msgsIn.getAttribute("d")
  await expect.poll(() => msgsIn.getAttribute("d"), { timeout: 5_000 }).not.toBe(before)

  await expect(servers.getByText("ok", { exact: true })).toBeVisible() // the server's HEALTHZ answer
  await expect(page.getByRole("status")).toContainText("All servers healthy")
  const asOf = await asOfTime(page).textContent()
  await expect.poll(() => asOfTime(page).textContent(), { timeout: 5_000 }).not.toBe(asOf)

  await setMonitoringURL(page, "app", process.env.E2E_MONITORING)
  await activate(page, "app")
  await expect(page.getByText("One server, via the Monitoring URL")).toBeVisible()
  await expect(servers.getByRole("rowheader")).toHaveCount(1)
  await setMonitoringURL(page, "app")
})

test("servers on different versions show a warning and are announced; leaving unsubscribes", async ({ page }) => {
  const frame = (versions: string[]): ServerFrame => {
    const overview: Overview = {
      source: "system",
      time: Math.floor(Date.now() / 1000),
      points: { connections: 3, msgsIn: 10, msgsOut: 10, bytesIn: 100, bytesOut: 100, slowConsumers: 0 },
      servers: versions.map((version, i) => ({ id: `n${i}`, name: `n${i}`, version, start: new Date().toISOString(), connections: 1, cpu: 1, mem: 1 << 20 })),
    }
    return { topic: "overview", overview }
  }
  const sent: string[] = []
  await page.routeWebSocket(/\/ws$/, (ws) => {
    ws.onMessage((m) => {
      sent.push(String(m))
      if (sent.length > 1) return
      ws.send(JSON.stringify(frame(["2.15.2", "2.15.2"])))
      setTimeout(() => ws.send(JSON.stringify(frame(["2.15.2", "2.15.2", "2.14.0"]))), 500)
    })
  })
  await page.goto("/overview")
  await expect(page.getByRole("main").getByText("Servers run different versions: 2.14.0, 2.15.2.")).toBeVisible()
  await expect(page.getByRole("status")).toContainText("Servers run different versions: 2.14.0, 2.15.2")

  await page.getByRole("navigation", { name: "Screens" }).getByRole("link", { name: "Streams" }).click()
  await expect.poll(() => sent).toEqual(['{"op":"sub","topic":"overview"}', '{"op":"unsub","topic":"overview"}'])
})
