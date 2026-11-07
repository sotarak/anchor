import { expect, type Page, test } from "@playwright/test";
import { OWNER } from "./owner";

const INTERACTIVE =
  "button, [role=button], [role=menuitem], [role=option], [role=checkbox], [role=combobox], a[href]";

/** Labels of visible, enabled interactive elements whose computed cursor is not `pointer`. */
async function withoutPointer(page: Page): Promise<string[]> {
  return page.evaluate((selector) => {
    return Array.from(document.querySelectorAll<HTMLElement>(selector))
      .filter((el) => el.offsetParent !== null || el.getClientRects().length > 0)
      .filter((el) => !(el as HTMLButtonElement).disabled)
      .filter(
        (el) => el.getAttribute("aria-disabled") !== "true" && !el.hasAttribute("data-disabled"),
      )
      .filter((el) => getComputedStyle(el).cursor !== "pointer")
      .map((el) =>
        (el.getAttribute("aria-label") ?? el.textContent ?? el.tagName).trim().slice(0, 40),
      );
  }, INTERACTIVE);
}

test("every clickable control shows a pointer cursor", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Password").fill(OWNER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole("button", { name: "New project" }).first()).toBeVisible();
  expect(await withoutPointer(page), "/projects").toEqual([]);

  await page.goto("/audit");
  await expect(page.getByRole("table")).toBeVisible();
  expect(await withoutPointer(page), "/audit").toEqual([]);

  // A project with one secret, so the environment page has a row menu.
  await page.goto("/projects");
  await page.getByRole("button", { name: "New project" }).first().click();
  const create = page.getByRole("dialog");
  await create.getByLabel("Name").fill("Cursor App");
  await create.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("link", { name: "Secrets" }).click();
  await page.getByRole("button", { name: "Add secret" }).first().click();
  const sheet = page.getByRole("dialog", { name: "Add secret" });
  await sheet.getByLabel("Key").fill("CURSOR_KEY");
  await sheet.getByLabel("Value").fill("cursor-value");
  await sheet.getByRole("button", { name: "Add secret" }).click();
  await expect(page.getByRole("row", { name: /CURSOR_KEY/ })).toBeVisible();
  expect(await withoutPointer(page), "environment page").toEqual([]);

  await page.getByRole("button", { name: "Actions for CURSOR_KEY" }).click();
  await expect(page.getByRole("menuitem").first()).toBeVisible();
  expect(await withoutPointer(page), "row menu").toEqual([]);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: /^Environment:/ }).click();
  await expect(page.getByRole("menu").or(page.getByRole("listbox")).first()).toBeVisible();
  expect(await withoutPointer(page), "environment switcher").toEqual([]);
});
