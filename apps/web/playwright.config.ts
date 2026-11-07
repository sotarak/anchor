import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

// One random root key per run, generated in memory. Set on process.env so the
// webServer launcher and the test workers (which re-load this file) all see the same value.
process.env.E2E_ROOT_KEY ??= randomBytes(32).toString("base64");

const PORT = 8788;

export default defineConfig({
  testDir: "./test/e2e",
  globalTeardown: "./test/e2e/global-teardown.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  // One server for the whole run: the smoke needs a fresh instance (it performs first-run setup),
  // so every later spec depends on it and signs in as its owner.
  projects: [
    { name: "smoke", testMatch: /smoke\.spec\.ts$/, use: { ...devices["Desktop Chrome"] } },
    {
      name: "m5",
      testMatch: /m5\.spec\.ts$/,
      dependencies: ["smoke"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "cursor",
      testMatch: /cursor\.spec\.ts$/,
      dependencies: ["smoke"],
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // CI builds the dashboard in an earlier step; locally the smoke always tests a fresh build.
    command: process.env.CI ? "node test/e2e/serve.mjs" : "pnpm build && node test/e2e/serve.mjs",
    url: `http://localhost:${PORT}/api/v1/setup/status`,
    env: { E2E_PORT: String(PORT) },
    // A reused server would hold another run's state.
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
