// Shared by build.mjs and test/unit/bundle.test.ts.
export const esbuildOptions = {
  entryPoints: [new URL("./src/index.ts", import.meta.url).pathname],
  // Not tsconfig.json: its `paths` point @anchor-secrets/sdk at the SDK source for tests, and
  // esbuild would bundle that source instead of leaving the import to npm.
  tsconfig: new URL("./tsconfig.build.json", import.meta.url).pathname,
  bundle: true,
  packages: "external",
  platform: "node",
  target: "node20",
  legalComments: "none",
  logLevel: "warning",
};
