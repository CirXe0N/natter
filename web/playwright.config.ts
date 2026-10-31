import { defineConfig, devices } from "@playwright/test"

// Run with `npm run e2e`, which builds web/dist first: the harness serves the embedded build.
export default defineConfig({
  testDir: "e2e",
  forbidOnly: !!process.env.CI,
  webServer: {
    command: "go run ./internal/e2eserver",
    cwd: "..",
    wait: { stdout: /E2E READY url=(?<e2e_url>\S+) token=(?<e2e_token>\S+) monitoring=(?<e2e_monitoring>\S+)/ },
    timeout: 120_000, // the first `go run` compiles nats-server
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
  },
  use: { baseURL: process.env.E2E_URL },
  projects: [
    { name: "setup", testMatch: /\.setup\.ts$/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "playwright/.auth/session.json" },
      dependencies: ["setup"],
    },
  ],
})
