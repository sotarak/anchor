#!/usr/bin/env node
// Executable entry for the Node bundle, the Bun binaries and `pnpm dev`.
// Kept separate from main.ts so importing main() (tests) never runs the CLI.
import { main } from "./main";

process.exitCode = await main(process.argv);
