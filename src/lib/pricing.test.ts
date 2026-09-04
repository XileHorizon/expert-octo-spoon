import { describe, expect, it } from "vitest";
import { priceJob, priceQuote, printedPages } from "./pricing";
import type { Catalog, QuoteJobInput } from "./types";

const letter = {
  id: "letter", name: "Letter", dimensions: "8.5 × 11", active: true, basePrice: "0.20",
  billingUnit: "printed_page" as const, minimumQuantity: 1, manualQuote: false, includedNote: null,
  papers: [
    { materialId: "std", name: "Standard", weight: "20 lb", category: "Uncoated", surcharge: "0", isStandard: true, active: true },
    { materialId: "gloss", name: "Gloss Paper", weight: "27 lb", category: "Gloss", surcharge: "0.08", isStandard: false, active: true },
    { materialId: "tbc", name: "Specialty", weight: null, category: null, surcharge: null, isStandard: false, active: true },
  ],
};
const poster = { ...letter, id: "poster", name: "Poster", basePrice: null, manualQuote: true, papers: [{ ...letter.papers[0] }] };

const catalog: Catalog = {
  fixtureMode: false, placeholderNotice: null, papers: [],
  products: [{ id: "p", name: "P", description: "", active: true, minimumQuantity: 1, sizes: [letter, poster] }],
  finishing: [
    { id: "fold", name: "Folding", unitPrice: "0.04", chargeBasis: "per_piece", sizeIds: ["letter"], active: true },
    { id: "setup", name: "File setup", unitPrice: "12.00", chargeBasis: "flat_per_job", sizeIds: [], active: true },
    { id: "binding", name: "Binding", unitPrice: "3.50", chargeBasis: "flat_per_job", sizeIds: ["legal"], active: true },
  ],
  bulkTiers: [
    { id: "t1", minQuantity: 100, discountPercent: "5", quantityBasis: "printed_pages", sizeIds: ["letter"], active: true },
    { id: "t2", minQuantity: 250, discountPercent: "10", quantityBasis: "printed_pages", sizeIds: ["letter"], active: true },
  ],
};

const job: QuoteJobInput = {
  clientId: "a", fileName: "a.pdf", fileSize: 10, mimeType: "application/pdf", pageCount: 1,
  productId: "p", sizeId: "letter", materialId: "std", quantity: 10, sides: 1,
  colorMode: "color", orientation: "portrait", finishingIds: [],
};

describe("pricing", () => {
  it("counts printed pages as pieces x pages x sides", () => {
    expect(printedPages({ ...job, quantity: 10, pageCount: 3, sides: 2 })).toBe(60);
  });

  it("prices the size base rate on printed pages", () => {
    expect(priceJob(job, catalog).subtotal).toBe("2.00");
  });

  it("adds the paper surcharge over the base price", () => {
    expect(priceJob({ ...job, materialId: "gloss" }, catalog).subtotal).toBe("2.80");
  });

  it("bills double-sided as two printed pages", () => {
    expect(priceJob({ ...job, sides: 2 }, catalog).subtotal).toBe("4.00");
  });

  it("applies only the highest qualifying discount to printing and paper", () => {
    const priced = priceJob({ ...job, quantity: 300, materialId: "gloss" }, catalog);
    // 300 x (0.20 + 0.08) = 84.00, less 10% = 75.60
    expect(priced.subtotal).toBe("75.60");
    expect(priced.discountPercent).toBe("10");
  });

  it("never discounts finishing or setup fees", () => {
    const priced = priceJob({ ...job, quantity: 300, finishingIds: ["setup"] }, catalog);
    // 300 x 0.20 = 60.00, less 10% = 54.00, plus an undiscounted 12.00 setup
    expect(priced.subtotal).toBe("66.00");
  });

  it("charges per-piece finishing by piece count, not printed pages", () => {
    const priced = priceJob({ ...job, pageCount: 4, finishingIds: ["fold"] }, catalog);
    // 10 x 4 x 0.20 = 8.00 printing, plus 10 x 0.04 = 0.40 folding
    expect(priced.subtotal).toBe("8.40");
  });

  it("requires manual pricing for manual-quote sizes", () => {
    expect(priceJob({ ...job, sizeId: "poster" }, catalog)).toMatchObject({ status: "manual", subtotal: null });
  });

  it("requires manual pricing for an unpriced paper", () => {
    expect(priceJob({ ...job, materialId: "tbc" }, catalog).status).toBe("manual");
  });

  it("rejects finishing that is not offered on the selected size", () => {
    expect(priceJob({ ...job, finishingIds: ["binding"] }, catalog).status).toBe("manual");
  });

  it("enforces the size minimum quantity", () => {
    const cards = { ...catalog, products: [{ ...catalog.products[0], sizes: [{ ...letter, minimumQuantity: 200 }] }] };
    expect(priceJob({ ...job, quantity: 199 }, cards)).toMatchObject({ status: "manual", subtotal: null });
  });

  it("reports a priced-items subtotal without presenting it as a total", () => {
    const quote = priceQuote([job, { ...job, clientId: "b", sizeId: "poster" }], catalog);
    expect(quote).toMatchObject({ status: "manual", total: null, pricedSubtotal: "2.00" });
  });

  it("returns an itemized breakdown for a priced job", () => {
    const priced = priceJob({ ...job, quantity: 300, materialId: "gloss", finishingIds: ["setup"] }, catalog);
    expect(priced.lines.map((line) => line.label)).toEqual([
      "Letter printing", "Gloss Paper paper", "Bulk discount (10% off)", "File setup",
    ]);
  });
});
