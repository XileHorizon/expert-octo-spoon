import { describe, expect, it } from "vitest";
import { priceQuote } from "./pricing";
import type { Catalog, QuoteJobInput } from "./types";

const TWO = BigInt(2);
const HUNDRED = BigInt(100);
const TEN_THOUSAND = BigInt(10_000);

const money4 = (value: string) => {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * TEN_THOUSAND + BigInt(fraction.padEnd(4, "0"));
};

const percentBasisPoints = (value: string) => {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * HUNDRED + BigInt(fraction.padEnd(2, "0"));
};

const roundFraction = (numerator: bigint, denominator: bigint) =>
  (numerator * TWO + denominator) / (denominator * TWO);

/** Independent integer/rational oracle: it does not call pricing helpers or Decimal. */
function oracleItemCents(input: {
  base: string;
  paper: string;
  quantity: number;
  pages: number;
  sides: 1 | 2;
  discountPercent: string;
  perPieceFinish: string;
  flatFinish: string;
}) {
  const printedPages = BigInt(input.quantity * input.pages * input.sides);
  const pieces = BigInt(input.quantity);
  const discountable = (money4(input.base) + money4(input.paper)) * printedPages;
  const denominator = TEN_THOUSAND;
  const factor = denominator - percentBasisPoints(input.discountPercent);
  const finishing = money4(input.perPieceFinish) * pieces + money4(input.flatFinish);
  // Values above are in 1/10,000 dollar units. Convert the exact rational result to cents once, half up.
  return roundFraction(discountable * factor + finishing * denominator, denominator * HUNDRED);
}

const size = {
  id: "letter", name: "Letter", dimensions: "8.5 x 11", active: true, basePrice: "0.1375",
  billingUnit: "printed_page" as const, minimumQuantity: 1, manualQuote: false, includedNote: null,
  papers: [{ materialId: "paper", name: "Paper", weight: null, category: null, surcharge: "0.0425", isStandard: true, active: true }],
};

const catalog: Catalog = {
  fixtureMode: false,
  modeAdjustments: { color: "0", blackWhite: "0", portrait: "0", landscape: "0" },
  placeholderNotice: null,
  minimumOrderTotal: "0.00",
  papers: [],
  products: [{ id: "print", name: "Print", description: "", active: true, minimumQuantity: 1, sizes: [size] }],
  finishing: [
    { id: "piece", name: "Per piece", unitPrice: "0.0315", chargeBasis: "per_piece", sizeIds: [], active: true },
    { id: "flat", name: "Flat", unitPrice: "1.2375", chargeBasis: "flat_per_job", sizeIds: [], active: true },
  ],
  bulkTiers: [{ id: "tier", minQuantity: 1, discountPercent: "7.25", quantityBasis: "printed_pages", sizeIds: [], active: true }],
};

const job: QuoteJobInput = {
  clientId: "job", fileName: "art.pdf", fileSize: 5, mimeType: "application/pdf", pageCount: 1,
  productId: "print", sizeId: "letter", materialId: "paper", quantity: 1, sides: 1,
  colorMode: "color", orientation: "portrait", finishingIds: ["piece", "flat"],
};

describe("pricing against an independent fixed-point oracle", () => {
  it.each([
    { quantity: 1, pages: 1, sides: 1 as const },
    { quantity: 2, pages: 3, sides: 2 as const },
    { quantity: 99, pages: 1, sides: 2 as const },
    { quantity: 1_000, pages: 17, sides: 1 as const },
    { quantity: 1_000_000, pages: 10_000, sides: 2 as const },
  ])("matches exact rational arithmetic at size boundaries: %o", ({ quantity, pages, sides }) => {
    const actual = priceQuote([{ ...job, quantity, pageCount: pages, sides }], catalog);
    const cents = oracleItemCents({
      base: "0.1375", paper: "0.0425", quantity, pages, sides,
      discountPercent: "7.25", perPieceFinish: "0.0315", flatFinish: "1.2375",
    });
    expect(actual).toMatchObject({ status: "priced", subtotal: `${cents / HUNDRED}.${String(cents % HUNDRED).padStart(2, "0")}` });
  });

  it("sums independently rounded item snapshots before applying the quote floor", () => {
    const one = oracleItemCents({
      base: "0.1375", paper: "0.0425", quantity: 1, pages: 1, sides: 1,
      discountPercent: "7.25", perPieceFinish: "0.0315", flatFinish: "1.2375",
    });
    const floorCatalog = { ...catalog, minimumOrderTotal: "9.99" };
    const actual = priceQuote([{ ...job, clientId: "a" }, { ...job, clientId: "b" }], floorCatalog);

    expect(actual).toMatchObject({
      subtotal: `${(one * TWO) / HUNDRED}.${String((one * TWO) % HUNDRED).padStart(2, "0")}`,
      total: "9.99",
      minimumOrderAdjustment: `${(BigInt(999) - one * TWO) / HUNDRED}.${String((BigInt(999) - one * TWO) % HUNDRED).padStart(2, "0")}`,
    });
  });

  it.each([
    ["disabled", "0.00", "1.44"],
    ["one cent below subtotal", "1.43", "1.44"],
    ["equal to subtotal", "1.44", "1.44"],
    ["one cent above subtotal", "1.45", "1.45"],
  ])("handles the quote-floor boundary when %s", (_label, minimumOrderTotal, expectedTotal) => {
    const noFinish = { ...catalog, minimumOrderTotal, finishing: [], bulkTiers: [] };
    const actual = priceQuote([{ ...job, quantity: 8, pageCount: 1, finishingIds: [] }], noFinish);
    expect(actual.total).toBe(expectedTotal);
    expect(actual.minimumOrderAdjustment).toBe(expectedTotal === "1.45" ? "0.01" : null);
  });
});
