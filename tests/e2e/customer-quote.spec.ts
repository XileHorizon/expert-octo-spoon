import { artworkInput, expect, invalidArtwork, test, validPdf } from "./fixtures";

test.describe("customer quote request", () => {
  test("shows upload validation and requires material before submission", async ({ page }) => {
    await page.goto("/");
    await artworkInput(page).setInputFiles(invalidArtwork);
    await expect(page.getByRole("alert").filter({ hasText: /Only PDF, PNG, and JPEG files/i })).toBeVisible();
    await artworkInput(page).setInputFiles(validPdf);
    await expect(page.getByText("customer-artwork.pdf", { exact: true })).toBeVisible();
    await page.getByLabel("Full Name *").fill("E2E Customer"); await page.getByLabel("Email Address *").fill("customer@example.test");
    await page.getByRole("button", { name: "Submit Official Quote Request" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /Choose a paper\/material for customer-artwork.pdf/i })).toBeVisible();
  });

  test("submits a configured quote request and displays its reference", async ({ page }) => {
    await page.goto("/"); await artworkInput(page).setInputFiles(validPdf);
    await page.getByLabel("Paper & Material Stock").selectOption({ index: 1 });
    await page.getByLabel("Full Name *").fill("E2E Customer"); await page.getByLabel("Company Name (Optional)").fill("Example Print Co.");
    await page.getByLabel("Email Address *").fill("customer@example.test"); await page.getByLabel("Phone Number").fill("614-555-0100");
    await page.getByRole("button", { name: "Submit Official Quote Request" }).click();
    await expect(page.getByRole("status")).toContainText("Request received."); await expect(page.getByRole("status")).toContainText("e2e-request-123");
  });

  test("reuses the logical submission idempotency key after a lost response", async ({ page }) => {
    const keys: string[] = [];
    let attempt = 0;
    await page.route("**/api/quote-requests", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      keys.push(route.request().headers()["idempotency-key"] ?? "");
      attempt += 1;
      if (attempt === 1) return route.abort("connectionfailed");
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ requestId: "e2e-retry-123", status: "request_received", pricingStatus: "priced" }),
      });
    });

    await page.goto("/"); await artworkInput(page).setInputFiles(validPdf);
    await page.getByLabel("Paper & Material Stock").selectOption({ index: 1 });
    await page.getByLabel("Full Name *").fill("Retry Customer");
    await page.getByLabel("Email Address *").fill("retry@example.test");
    await page.getByRole("button", { name: "Submit Official Quote Request" }).click();
    await expect(page.locator(".quote-error")).toContainText(/failed to fetch|request could not be submitted/i);
    await page.getByRole("button", { name: "Submit Official Quote Request" }).click();
    await expect(page.getByRole("status")).toContainText("e2e-retry-123");

    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
  });
});
