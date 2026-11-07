import { defineConfig } from "vitest/config";

// Tests run against the SDK's source, so they do not need `packages/sdk/dist`.
export default defineConfig({
  resolve: {
    alias: {
      "@anchor-secrets/sdk": new URL("../sdk/src/index.ts", import.meta.url).pathname,
    },
  },
  // Tests use Nest's (legacy) decorators, as apps do; the package source itself has none.
  oxc: { decorator: { legacy: true } },
  test: { include: ["test/**/*.test.ts"] },
});
