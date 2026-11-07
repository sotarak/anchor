import { randomBytes } from "node:crypto";
import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "../../wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, "migrations")),
          // Fresh random key per test run; never a real key.
          ANCHOR_ROOT_KEY: randomBytes(32).toString("base64"),
          // Not the default "rk1", so code that ignores the configured id fails tests.
          ANCHOR_ROOT_KEY_ID: "rk-test",
        },
      },
    })),
  ],
  test: {
    setupFiles: ["./test/support/apply-migrations.ts"],
  },
});
