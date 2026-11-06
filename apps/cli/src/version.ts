import { readFileSync } from "node:fs";

// Release builds replace ANCHOR_CLI_VERSION through esbuild/Bun `define`.
declare const ANCHOR_CLI_VERSION: string | undefined;

function readPackageVersion(): string {
  const url = new URL("../package.json", import.meta.url);
  return (JSON.parse(readFileSync(url, "utf8")) as { version: string }).version;
}

export const CLI_VERSION: string =
  typeof ANCHOR_CLI_VERSION === "string" ? ANCHOR_CLI_VERSION : readPackageVersion();
