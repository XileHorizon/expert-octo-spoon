import { expect, test as base } from "@playwright/test";
import type { Page } from "@playwright/test";

export const validPdf = {
  name: "customer-artwork.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"),
};

export const invalidArtwork = {
  name: "customer-artwork.txt",
  mimeType: "text/plain",
  buffer: Buffer.from("not print artwork"),
};

export const test = base.extend<{ mockQuoteSubmission: void }>({
  // The default local server has no SMTP recipient. Mock only the notification POST
  // so customer UI coverage remains deterministic; set E2E_LIVE_SUBMISSION=true to
  // send a real request to E2E_BASE_URL instead.
  mockQuoteSubmission: [async ({ page }, use) => {
    if (process.env.E2E_LIVE_SUBMISSION === "true") return use();
    await page.route("**/api/quote-requests", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ requestId: "e2e-request-123", status: "request_received", pricingStatus: "priced" }),
      });
    });
    await use();
  }, { auto: true }],
});

export { expect };

/** The production component has an unlabeled visually-hidden file input. */
export function artworkInput(page: Page) {
  return page.locator('input[type="file"]');
}
