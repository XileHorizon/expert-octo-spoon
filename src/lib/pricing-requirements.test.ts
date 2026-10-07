import { describe, expect, it } from "vitest";
import { priceQuote } from "./pricing";
import type { BulkTier, Catalog, QuoteJobInput, SizeOption } from "./types";

const ids = {
  letter: "20000000-0000-4000-8000-000000000001",
  legal: "20000000-0000-4000-8000-000000000002",
  tabloid: "20000000-0000-4000-8000-000000000003",
  business: "20000000-0000-4000-8000-000000000006",
  card5: "20000000-0000-4000-8000-000000000008",
  card4: "20000000-0000-4000-8000-000000000009",
  standard: "30000000-0000-4000-8000-000000000001",
  premium: "30000000-0000-4000-8000-000000000002",
  tabloidStandard: "30000000-0000-4000-8000-000000000006",
  tabloidCardstock: "30000000-0000-4000-8000-000000000007",
  cardStock: "30000000-0000-4000-8000-000000000013",
};

const paper = (materialId: string, name: string, surcharge = "0") => ({ materialId, name, weight: null, category: null, surcharge, isStandard: surcharge === "0", active: true });
const size = (id: string, name: string, billingUnit: SizeOption["billingUnit"], papers: SizeOption["papers"], extra: Partial<SizeOption> = {}): SizeOption => ({
  id, name, dimensions: null, active: true, basePrice: "0", billingUnit, minimumQuantity: 1, manualQuote: false, includedNote: null, papers, ...extra,
});
const rate = (id: string, sizeId: string, minQuantity: number, unitPrice: string, scope: Partial<BulkTier> = {}): BulkTier => ({
  id, minQuantity, unitPrice, discountPercent: null, quantityBasis: "printed_pages", materialId: null, colorMode: null, sides: null, sizeIds: [sizeId], active: true, ...scope,
});
const discount = (id: string, sizeId: string): BulkTier => ({ id, minQuantity: 101, unitPrice: null, discountPercent: "10", quantityBasis: "printed_pages", materialId: null, colorMode: null, sides: null, sizeIds: [sizeId], active: true });

const sizes: SizeOption[] = [
  size(ids.letter, "Letter", "printed_page", [paper(ids.standard, "Standard"), paper(ids.premium, "Premium Color", "0.10")]),
  size(ids.legal, "Legal", "printed_page", [paper(ids.standard, "Standard")]),
  size(ids.tabloid, "Tabloid", "printed_page", [paper(ids.tabloidStandard, "Standard"), paper(ids.tabloidCardstock, "Cardstock", "0.20")]),
  size(ids.card5, "5 × 7 Cards", "card", [paper(ids.cardStock, "Card stock")], { maxAutoQuoteQuantity: 200, manualQuoteMessage: "Quantities of 201 or more are quoted manually." }),
  size(ids.card4, "4 × 6 Cards", "card", [paper(ids.cardStock, "Card stock")], { maxAutoQuoteQuantity: 200, manualQuoteMessage: "Quantities of 201 or more are quoted manually." }),
  size(ids.business, "Business Cards", "card", [paper(ids.cardStock, "Card stock")], { manualQuote: true, manualQuoteMessage: "Pricing will be sent for approval." }),
];

const rates: BulkTier[] = [
  rate("l-bw-1", ids.letter, 1, "0.12", { colorMode: "black-white" }),
  rate("l-bw-101", ids.letter, 101, "0.11", { colorMode: "black-white" }),
  rate("l-bw-501", ids.letter, 501, "0.10", { colorMode: "black-white" }),
  rate("l-bw-2001", ids.letter, 2001, "0.09", { colorMode: "black-white" }),
  rate("l-c-1", ids.letter, 1, "0.55", { colorMode: "color" }),
  rate("l-c-100", ids.letter, 100, "0.50", { colorMode: "color" }),
  rate("l-c-500", ids.letter, 500, "0.40", { colorMode: "color" }),
  rate("legal-bw", ids.legal, 1, "0.17", { colorMode: "black-white" }),
  rate("legal-c", ids.legal, 1, "0.75", { colorMode: "color" }), discount("legal-10", ids.legal),
  rate("tab-bw", ids.tabloid, 1, "0.25", { colorMode: "black-white" }),
  rate("tab-c", ids.tabloid, 1, "1.00", { colorMode: "color" }),
  rate("tab-card-bw", ids.tabloid, 1, "0.50", { colorMode: "black-white", materialId: ids.tabloidCardstock }),
  rate("tab-card-c", ids.tabloid, 1, "1.50", { colorMode: "color", materialId: ids.tabloidCardstock }), discount("tab-10", ids.tabloid),
  ...[ids.card5, ids.card4].flatMap((sizeId, index) => [
    rate(`card-${index}-1`, sizeId, 1, "0.50", { quantityBasis: "pieces", sides: 1 }),
    rate(`card-${index}-2`, sizeId, 1, "0.75", { quantityBasis: "pieces", sides: 2 }),
  ]),
];

const catalog: Catalog = { fixtureMode: false, placeholderNotice: null, minimumOrderTotal: "0", papers: [], finishing: [], bulkTiers: rates, modeAdjustments: { color: "0", blackWhite: "0", portrait: "0", landscape: "0" }, products: [{ id: "10000000-0000-4000-8000-000000000001", name: "Print products", description: "", active: true, minimumQuantity: 1, sizes }] };
const job = (sizeId: string, materialId: string, quantity: number, colorMode: QuoteJobInput["colorMode"] = "black-white", sides: 1 | 2 = 1): QuoteJobInput => ({ clientId: "x", fileName: "x.pdf", fileSize: 1, mimeType: "application/pdf", pageCount: 1, productId: catalog.products[0].id, sizeId, materialId, quantity, sides, colorMode, orientation: "portrait", finishingIds: [] });
const total = (input: QuoteJobInput) => priceQuote([input], catalog);

const boundaryCases: Array<[string, QuoteJobInput, string]> = [
  ["Letter B/W 100", job(ids.letter, ids.standard, 100), "12.00"], ["Letter B/W 101", job(ids.letter, ids.standard, 101), "11.11"],
  ["Letter B/W 500", job(ids.letter, ids.standard, 500), "55.00"], ["Letter B/W 501", job(ids.letter, ids.standard, 501), "50.10"],
  ["Letter B/W 2000", job(ids.letter, ids.standard, 2000), "200.00"], ["Letter B/W 2001", job(ids.letter, ids.standard, 2001), "180.09"],
  ["Letter color 99", job(ids.letter, ids.standard, 99, "color"), "54.45"], ["Letter color 100", job(ids.letter, ids.standard, 100, "color"), "50.00"],
  ["Letter color 499", job(ids.letter, ids.standard, 499, "color"), "249.50"], ["Letter color 500", job(ids.letter, ids.standard, 500, "color"), "200.00"],
];

describe("owner pricing requirements", () => {
  it.each(boundaryCases)("prices %s at the exact threshold", (_label, input, expected) => expect(total(input).total).toBe(expected));

  it("keeps double-sided document pricing identical to single-sided pricing", () => {
    expect(total(job(ids.letter, ids.standard, 10, "black-white", 2)).total).toBe("1.20");
    expect(total(job(ids.letter, ids.premium, 10, "color", 2)).total).toBe("6.50");
  });

  it.each([[ids.legal, ids.standard, "0.17", "0.75"], [ids.tabloid, ids.tabloidStandard, "0.25", "1.00"], [ids.tabloid, ids.tabloidCardstock, "0.50", "1.50"]])("prices size/material rates and applies 10%% only at 101", (sizeId, materialId, bw, color) => {
    expect(total(job(sizeId, materialId, 1)).total).toBe(bw);
    expect(total(job(sizeId, materialId, 1, "color")).total).toBe(color);
    expect(total(job(sizeId, materialId, 100)).total).toBe(String((Number(bw) * 100).toFixed(2)));
    expect(total(job(sizeId, materialId, 101)).total).toBe(String((Number(bw) * 101 * 0.9).toFixed(2)));
  });

  it.each([ids.card5, ids.card4])("uses the one-sided card rate for either side selection through 200, then routes manual", (sizeId) => {
    expect(total(job(sizeId, ids.cardStock, 200, "color", 1)).total).toBe("100.00");
    expect(total(job(sizeId, ids.cardStock, 200, "black-white", 2)).total).toBe("100.00");
    expect(total(job(sizeId, ids.cardStock, 201)).items[0]).toMatchObject({ status: "manual", reason: expect.stringContaining("201") });
  });

  it("always routes Business Cards to approval with explicit copy", () => {
    expect(total(job(ids.business, ids.cardStock, 200)).items[0]).toMatchObject({ status: "manual", reason: "Pricing will be sent for approval." });
  });
});
