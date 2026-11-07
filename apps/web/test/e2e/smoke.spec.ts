import { expect, test } from "@playwright/test";
import { OWNER } from "./owner";

// Must equal the CSP in docs/superpowers/plans/2026-11-06-anchor-m4-dashboard.md (Global Constraints)
// and public/_headers.
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; " +
  "connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

const VALUE = "world-smoke-123";

test("setup → project → secret reveal/re-mask → logout → login, with no CSP violations", async ({
  page,
}) => {
  const violations: string[] = [];
  page.on("console", (msg) => {
    const text = msg.text();
    if (text.includes("Content Security Policy") || text.includes("Refused to")) {
      const { url, lineNumber, columnNumber } = msg.location();
      violations.push(`${text.slice(0, 160)} @ ${url}:${lineNumber}:${columnNumber}`);
    }
  });

  // A fresh instance sends everyone to first-run setup.
  const first = await page.goto("/");
  expect(first?.headers()["content-security-policy"]).toBe(CSP);
  await expect(page).toHaveURL(/\/setup$/);

  await expect(page.getByLabel("Setup token")).toHaveCount(0);
  await page.getByLabel("Name").fill(OWNER.name);
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Password", { exact: true }).fill(OWNER.password);
  await page.getByLabel("Confirm password").fill(OWNER.password);
  await page.getByRole("button", { name: "Create owner account" }).click();
  await expect(page).toHaveURL(/\/projects$/);

  // Create a project; it lands on the overview.
  await page.getByRole("button", { name: "New project" }).first().click();
  const sheet = page.getByRole("dialog");
  // Radix's scroll lock styles must apply under the strict CSP, not just fail quietly.
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).overflow))
    .toBe("hidden");
  await sheet.getByLabel("Name").fill("Smoke App");
  await expect(sheet.getByLabel("Slug")).toHaveValue("smoke-app");
  await sheet.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/projects\/smoke-app$/);

  // Add a secret in Development.
  await page.goto("/projects/smoke-app/environments/dev");
  await page.getByRole("button", { name: "Add secret" }).first().click();
  const add = page.getByRole("dialog");
  await add.getByLabel("Key").fill("HELLO");
  await add.getByLabel("Value").fill(VALUE);
  await add.getByRole("button", { name: "Add secret" }).click();
  await expect(page.getByText("Secret saved")).toBeVisible();
  // sonner's stylesheet is loaded from 'self', so toasts are positioned, not inline in the page.
  expect(
    await page.locator("[data-sonner-toaster]").evaluate((el) => getComputedStyle(el).position),
  ).toBe("fixed");

  // Overlays that inject styles at runtime must also work under the CSP: Select (Radix renders a
  // <style> in its viewport) and Popover (environment switcher).
  await page.getByRole("combobox", { name: "Rows per page" }).click();
  await expect(page.getByRole("listbox")).toBeVisible();
  expect(
    await page
      .locator("[data-radix-select-viewport]")
      .evaluate((el) => getComputedStyle(el).scrollbarWidth),
  ).toBe("none");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Environment: / }).click();
  await expect(page.getByRole("option", { name: /Development/ })).toBeVisible();
  await page.keyboard.press("Escape");

  const row = page.getByRole("row", { name: /HELLO/ });
  await expect(row).toContainText("••••••••");
  await expect(page.locator("body")).not.toContainText(VALUE);

  // Explicit reveal shows the value; a reload masks it again.
  await row.hover();
  await row.getByRole("button", { name: "Reveal value" }).click();
  await expect(row.getByText(VALUE)).toBeVisible();
  const reloaded = await page.reload();
  expect(reloaded?.headers()["content-security-policy"]).toBe(CSP);
  await expect(page.getByRole("row", { name: /HELLO/ })).toContainText("••••••••");
  await expect(page.locator("body")).not.toContainText(VALUE);

  // Log out, then back in.
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Password").fill(OWNER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/projects$/);

  expect(violations).toEqual([]);
});
