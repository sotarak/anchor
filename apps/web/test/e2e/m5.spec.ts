import { expect, type Page, test } from "@playwright/test";
import { OWNER } from "./owner";

const PASSWORD = "pw-e2e-5f1";
const RAW = "postgres://u:${PASSWORD}@h/db";
const RESOLVED = `postgres://u:${PASSWORD}@h/db`;

async function addSecret(page: Page, key: string, value: string) {
  await page.getByRole("button", { name: "Add secret" }).first().click();
  const sheet = page.getByRole("dialog", { name: "Add secret" });
  await sheet.getByLabel("Key").fill(key);
  await sheet.getByLabel("Value").fill(value);
  await sheet.getByRole("button", { name: "Add secret" }).click();
  await expect(page.getByRole("row", { name: new RegExp(key) })).toBeVisible();
}

async function rowMenu(page: Page, key: string, item: string) {
  await page.getByRole("button", { name: `Actions for ${key}` }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

test("folder → reference → resolved preview → history → rollback", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (msg) => {
    const text = msg.text();
    if (text.includes("Content Security Policy") || text.includes("Refused to")) {
      violations.push(text.slice(0, 160));
    }
  });

  await page.goto("/login");
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Password").fill(OWNER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.getByRole("button", { name: "New project" }).first().click();
  const create = page.getByRole("dialog");
  await create.getByLabel("Name").fill("M5 App");
  await create.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/projects\/m5-app$/);

  // A folder /db, entered by clicking its row.
  await page.goto("/projects/m5-app/environments/dev");
  await page.getByRole("button", { name: "More create options" }).click();
  await page.getByRole("menuitem", { name: "New folder" }).click();
  const folder = page.getByRole("dialog", { name: "New folder" });
  await folder.getByLabel("Name").fill("db");
  await folder.getByRole("button", { name: "Create folder" }).click();
  await page.getByRole("button", { name: "db", exact: true }).click();
  await expect(page.getByText("Secrets in /db")).toBeVisible();

  await addSecret(page, "PASSWORD", PASSWORD);
  await addSecret(page, "DB_URL", RAW);

  // Revealing in the table shows the stored value with a reference chip.
  const row = page.getByRole("row", { name: /DB_URL/ });
  await row.hover();
  await row.getByRole("button", { name: "Reveal value" }).click();
  await expect(row.getByText("${PASSWORD}")).toBeVisible();
  await row.getByRole("button", { name: "Hide value" }).click();

  // The editor's resolved preview expands it on request.
  await rowMenu(page, "DB_URL", "Edit");
  const edit = page.getByRole("dialog", { name: "Edit DB_URL" });
  await expect(edit.getByText(RESOLVED)).toHaveCount(0);
  await edit.getByRole("button", { name: "Show resolved value" }).click();
  await expect(edit.getByText(RESOLVED)).toBeVisible();
  // Save a second version.
  await edit.getByLabel("Value").fill("postgres://u:${PASSWORD}@h2/db");
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("row", { name: /DB_URL/ })).toContainText("v2");

  // History, then roll back to v1: a new v3 becomes current.
  await rowMenu(page, "DB_URL", "History");
  const history = page.getByRole("dialog", { name: "History" });
  await history.getByRole("button", { name: "Roll back to v1" }).click();
  await page
    .getByRole("dialog", { name: "Roll back DB_URL to v1" })
    .getByRole("button", { name: "Roll back" })
    .click();
  await expect(page.getByText("Rolled back to v1")).toBeVisible();
  await expect(history.getByRole("row", { name: /v3/ })).toContainText("Current");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("row", { name: /DB_URL/ })).toContainText("v3");

  expect(violations).toEqual([]);
});
