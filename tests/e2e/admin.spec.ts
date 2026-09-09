import { expect, test } from "./fixtures";

const adminEmail = process.env.E2E_ADMIN_EMAIL;
const adminPassword = process.env.E2E_ADMIN_PASSWORD;
const requestCustomer = process.env.E2E_REQUEST_CUSTOMER;

test.describe("owner portal", () => {
  test("reports unavailable login infrastructure in local mode", async ({ page }) => {
    test.skip(Boolean(adminEmail && adminPassword), "Live credentials exercise the successful login path below.");
    await page.goto("/admin/login"); await page.getByLabel("Email").fill("owner@example.test"); await page.getByLabel("Password").fill("incorrect-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("status")).toContainText(/database is not configured|credentials did not match/i);
  });

  test("signs in, opens a request, and saves its status", async ({ page }) => {
    test.skip(!(adminEmail && adminPassword && requestCustomer), "Set E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, and E2E_REQUEST_CUSTOMER against a disposable seeded MySQL environment.");
    await page.goto("/admin/login"); await page.getByLabel("Email").fill(adminEmail!); await page.getByLabel("Password").fill(adminPassword!);
    await page.getByRole("button", { name: "Sign in" }).click(); await expect(page.getByRole("navigation", { name: "Owner portal navigation" })).toBeVisible();
    await page.getByLabel("Search").fill(requestCustomer!); await page.getByRole("button", { name: "Refresh" }).click();
    const row = page.getByRole("row").filter({ hasText: requestCustomer! }).first(); await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Open" }).click(); await expect(page.getByRole("heading", { name: requestCustomer! })).toBeVisible();
    await row.getByRole("combobox").selectOption("in_progress"); await expect(page.getByRole("status")).toContainText("Status saved.");
  });
});
