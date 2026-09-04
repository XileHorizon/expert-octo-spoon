import { describe, expect, it } from "vitest";
import { priceQuote } from "./pricing";
import { formatQuoteEmail } from "./quote-email";
import type { Catalog } from "./types";
import type { QuoteRequestInput } from "./validation";

const size = {
  id: "standard", name: '3.5 × 2"', dimensions: "3.5 × 2", active: true,
  basePrice: "0.20", billingUnit: "card" as const, minimumQuantity: 200, manualQuote: false, includedNote: null,
  papers: [{ materialId: "matte", name: "16pt Matte", weight: "16 pt", category: "Matte", surcharge: "0", isStandard: true, active: true }],
};

const catalog: Catalog = {
  fixtureMode: false,
  placeholderNotice: null,
  papers: [{ id: "matte", name: "16pt Matte", weight: "16 pt", category: "Matte", active: true }],
  products: [{ id: "cards", name: "Business Cards", description: "", active: true, minimumQuantity: 200, sizes: [size] }],
  finishing: [{ id: "rounded", name: "Rounded corners", active: true, unitPrice: "0.03", chargeBasis: "per_piece", sizeIds: [] }],
  bulkTiers: [],
};

const payload: QuoteRequestInput = {
  idempotencyKey: "123e4567-e89b-42d3-a456-426614174000",
  customer: { name: "Kevin", email: "kevin@example.com", organization: "Acme", phone: "555-0100" },
  jobs: [{ clientId: "job-1", fileName: "front.pdf", fileSize: 2048, mimeType: "application/pdf", pageCount: 2, productId: "cards", sizeId: "standard", materialId: "matte", quantity: 200, sides: 2, colorMode: "color", orientation: "landscape", finishingIds: ["rounded"], notes: "Keep colors vivid" }],
};

describe("formatQuoteEmail", () => {
  it("includes complete customer, per-file production, and pricing details", () => {
    const pricing = priceQuote(payload.jobs, catalog);
    const email = formatQuoteEmail({ requestId: "quote-123", payload, pricing, catalog });
    for (const detail of ["Reference: quote-123", "Name: Kevin", "Organization: Acme", "Original: front.pdf", "Pages: 2", "Product: Business Cards", "Finished size: 3.5 × 2", "Material: 16pt Matte", "Quantity: 200", "Printed sides: Double-sided", "Ink colorway: Full Color (CMYK)", "Orientation: Landscape", "Finishing: Rounded corners", "Notes: Keep colors vivid", "Estimated total: $46.00"]) {
      expect(email).toContain(detail);
    }
  });

  it("itemizes printing, paper, discounts, and finishing", () => {
    const discounted: Catalog = { ...catalog, bulkTiers: [{ id: "t", minQuantity: 100, discountPercent: "10", quantityBasis: "pieces", sizeIds: [], active: true }] };
    const email = formatQuoteEmail({ requestId: "quote-789", payload, pricing: priceQuote(payload.jobs, discounted), catalog: discounted });
    expect(email).toContain("Breakdown:");
    expect(email).toContain("Bulk discount (10% off)");
    expect(email).toContain("Rounded corners");
  });

  it("states when pricing and optional fields require review", () => {
    const manualCatalog: Catalog = { ...catalog, products: [{ ...catalog.products[0], sizes: [{ ...size, basePrice: null, manualQuote: true }] }] };
    const manualPayload = { ...payload, customer: { name: "Kevin", email: "kevin@example.com", organization: "", phone: "" }, jobs: [{ ...payload.jobs[0], notes: "", finishingIds: [] }] };
    const email = formatQuoteEmail({ requestId: "quote-456", payload: manualPayload, pricing: priceQuote(manualPayload.jobs, manualCatalog), catalog: manualCatalog });
    expect(email).toContain("Organization: Not provided");
    expect(email).toContain("Finishing: None selected");
    expect(email).toContain("Notes: None");
    expect(email).toContain("Pricing status: Manual quote required");
    expect(email).toContain("Estimated total: Manual quote");
  });
});
