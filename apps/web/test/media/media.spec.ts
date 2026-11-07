// Writes the README media to docs/media: dashboard screenshots, then the CLI recording (vhs).
// Run with `pnpm --filter @anchor/web media`; see docs/media/README.md.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { seedDemo } from "./seed";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const media = join(root, "docs/media");
const cli = join(root, "apps/cli/dist/anchor.mjs");

let owner: { email: string; password: string };

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ baseURL }) => {
  if (!baseURL) throw new Error("baseURL must be set");
  owner = await seedDemo(baseURL);
});

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(owner.email);
  await page.getByLabel("Password").fill(owner.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/projects$/);
}

/** Lets fade-ins finish so no shot catches a half-transparent row. */
const settle = (page: Page) => page.waitForTimeout(500);

test("dashboard screenshots", async ({ page }) => {
  await signIn(page);

  await page.goto("/projects/payments-api/environments/prod");
  const row = page.getByRole("row", { name: /DATABASE_URL/ });
  await expect(row).toBeVisible();
  await row.hover();
  await settle(page);
  await page.screenshot({ path: join(media, "secrets.png") });

  await page.goto("/projects/payments-api");
  await expect(page.getByRole("row", { name: /API_BASE_URL/ })).toBeVisible();
  await settle(page);
  await page.screenshot({ path: join(media, "overview.png") });

  await page.goto("/projects/payments-api/environments/prod");
  await page.getByRole("button", { name: "Actions for LOG_LEVEL" }).click();
  await page.getByRole("menuitem", { name: "History" }).click();
  await expect(page.getByRole("dialog", { name: "History" }).getByText("v2")).toBeVisible();
  await settle(page);
  await page.screenshot({ path: join(media, "history.png") });

  await page.goto("/projects/payments-api/settings/service-tokens");
  await expect(page.getByRole("row", { name: /github-actions-deploy/ })).toBeVisible();
  await settle(page);
  await page.screenshot({ path: join(media, "service-tokens.png") });

  await page.goto("/audit");
  await expect(page.getByRole("row", { name: /secret\.created/ }).first()).toBeVisible();
  await settle(page);
  await page.screenshot({ path: join(media, "audit.png") });
});

test("CLI recording", async ({ baseURL }) => {
  const vhs = spawnSync("vhs", ["--version"], { encoding: "utf8" });
  test.skip(vhs.status !== 0, "install vhs: brew install vhs");
  expect(existsSync(cli), "build the CLI first: pnpm --filter ./apps/cli build").toBe(true);

  // A throwaway config dir and file credential store: never the real keychain or ~/.config.
  const home = mkdtempSync(join(tmpdir(), "anchor-media-"));
  const bin = join(home, "bin");
  spawnSync("mkdir", ["-p", bin]);
  writeFileSync(join(bin, "anchor"), `#!/bin/sh\nexec node "${cli}" "$@"\n`);
  chmodSync(join(bin, "anchor"), 0o755);
  try {
    const run = spawnSync("vhs", ["docs/media/cli.tape"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        ANCHOR_API_URL: baseURL,
        ANCHOR_CREDENTIAL_STORE: "file",
        XDG_CONFIG_HOME: join(home, "config"),
      },
    });
    expect(run.status, run.stderr).toBe(0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
