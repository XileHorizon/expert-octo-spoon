import { describe, expect, it } from "vitest";
import { pricingDraftSchema } from "./admin-validation";

const paperId = "11111111-1111-4111-8111-111111111111";
const sizeId = "22222222-2222-4222-8222-222222222222";

const draft = {
  papers: [{ id: paperId, name: "Standard", weight: "20 lb", category: "Uncoated", active: true, sort_order: 0 }],
  sizes: [{
    id: sizeId, name: "Letter", dimensions: "8.5 × 11", base_price: "0.20", billing_unit: "printed_page" as const,
    minimum_quantity: 1, manual_quote: false, included_note: null, active: true, sort_order: 0,
    papers: [{ material_id: paperId, surcharge: "0", is_standard: true, active: true }],
  }],
  finishing: [{ name: "Folding", unit_price: "0.04", charge_basis: "per_piece" as const, size_ids: [sizeId], active: true, sort_order: 0 }],
  bulk_tiers: [{ min_quantity: 100, discount_percent: "5", quantity_basis: "printed_pages" as const, size_ids: [sizeId], active: true, sort_order: 0 }],
};

const parse = (value: unknown) => pricingDraftSchema.safeParse(value);
const message = (value: unknown) => parse(value).error?.issues[0]?.message ?? "";

describe("pricing draft validation", () => {
  it("accepts a complete draft", () => expect(parse(draft).success).toBe(true));

  it("requires a base price unless the size is a manual quote", () => {
    expect(message({ ...draft, sizes: [{ ...draft.sizes[0], base_price: null }] })).toContain("manual quote");
    expect(parse({ ...draft, sizes: [{ ...draft.sizes[0], base_price: null, manual_quote: true }] }).success).toBe(true);
  });

  it("rejects negative and malformed money", () => {
    expect(parse({ ...draft, sizes: [{ ...draft.sizes[0], base_price: "-1" }] }).success).toBe(false);
    expect(parse({ ...draft, sizes: [{ ...draft.sizes[0], base_price: "abc" }] }).success).toBe(false);
  });

  it("keeps discounts within 0-100 percent", () => {
    expect(parse({ ...draft, bulk_tiers: [{ ...draft.bulk_tiers[0], discount_percent: "120" }] }).success).toBe(false);
    expect(parse({ ...draft, bulk_tiers: [{ ...draft.bulk_tiers[0], discount_percent: "15.5" }] }).success).toBe(true);
  });

  it("allows only one standard paper per size", () => {
    const papers = [
      { material_id: paperId, surcharge: "0", is_standard: true, active: true },
      { material_id: "33333333-3333-4333-8333-333333333333", surcharge: "0.05", is_standard: true, active: true },
    ];
    expect(message({ ...draft, papers: [...draft.papers, { id: "33333333-3333-4333-8333-333333333333", name: "Gloss", weight: null, category: null, active: true, sort_order: 1 }], sizes: [{ ...draft.sizes[0], papers }] })).toContain("one standard paper");
  });

  it("rejects a size that references a missing paper", () => {
    expect(message({ ...draft, papers: [] })).toContain("no longer exists");
  });

  it("rejects duplicate active thresholds on the same basis", () => {
    expect(message({ ...draft, bulk_tiers: [draft.bulk_tiers[0], { ...draft.bulk_tiers[0], sort_order: 1 }] })).toContain("same quantity");
  });

  it("rejects unknown fields", () => {
    expect(parse({ ...draft, unexpected: true }).success).toBe(false);
  });

  it("requires a minimum quantity of at least one", () => {
    expect(parse({ ...draft, sizes: [{ ...draft.sizes[0], minimum_quantity: 0 }] }).success).toBe(false);
  });
});
