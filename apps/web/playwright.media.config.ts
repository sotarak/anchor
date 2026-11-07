import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

// README media (docs/media): a fresh local instance with fake demo data. Not part of `pnpm e2e`.
// Run with `pnpm --filter @anchor/web media` (needs `vhs` on PATH for the CLI recording).
process.env.E2E_ROOT_KEY ??= randomBytes(32).toString("base64");

const PORT = 8791;

export default defineConfig({
  testDir: "./test/media",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 180_000,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: "light",
  },
  webServer: {
    command: "pnpm build && node test/e2e/serve.mjs",
    url: `http://localhost:${PORT}/api/v1/setup/status`,
    env: { E2E_PORT: String(PORT) },
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
