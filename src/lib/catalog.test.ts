import { describe, expect, it } from "vitest";
import { compatibleFinishingIds, finishingForSize, getSeedCatalog, minimumForSize } from "./catalog";

const expected: Record<string, string[]> = {
  Letter: ["Standard", "Premium Color", "Gloss Paper", "Cardstock"],
  Legal: ["Standard"],
  Tabloid: ["Standard", "Cardstock"],
  Poster: ["Paper options to be confirmed"],
  "Large Poster": ["Paper options to be confirmed"],
  "Business Cards": ["Business card stock", "Business card stock"],
  Custom: ["Paper options to be confirmed"],
  "5 × 7 Cards": ["Card stock"],
  "4 × 6 Cards": ["Card stock"],
};

describe("starter catalog", () => {
  it("contains all nine required sizes in order", () => {
    expect(getSeedCatalog().products[0].sizes.map((size) => size.name)).toEqual(Object.keys(expected));
  });

  it("maps only the required papers to each size", () => {
    for (const size of getSeedCatalog().products[0].sizes) {
      expect(size.papers.map((paper) => paper.name)).toEqual(expected[size.name]);
    }
  });

  it("keeps identical paper names distinct by weight", () => {
    const cards = getSeedCatalog().products[0].sizes.find((size) => size.name === "Business Cards");
    expect(cards?.papers.map((paper) => paper.weight)).toEqual(["50 lb", "100 lb"]);
  });

  it("enforces a 200 business-card minimum without raising other sizes", () => {
    const product = getSeedCatalog().products[0];
    const cards = product.sizes.find((size) => size.name === "Business Cards");
    const letter = product.sizes.find((size) => size.name === "Letter");
    expect(minimumForSize(cards, product.minimumQuantity)).toBe(200);
    expect(minimumForSize(letter, product.minimumQuantity)).toBe(1);
  });

  it("marks options unconfirmed and leaves production prices unset by default", () => {
    const catalog = getSeedCatalog();
    expect(catalog.placeholderNotice).toContain("confirmed");
    expect(catalog.products[0].sizes.every((size) => size.basePrice === null)).toBe(true);
    expect(catalog.finishing.every((option) => option.unitPrice === null)).toBe(true);
    expect(catalog.bulkTiers).toEqual([]);
  });

  it("marks Custom and posters as manual-quote sizes", () => {
    const sizes = getSeedCatalog().products[0].sizes;
    expect(sizes.find((size) => size.name === "Custom")?.manualQuote).toBe(true);
    expect(sizes.find((size) => size.name === "Poster")?.manualQuote).toBe(true);
    expect(sizes.find((size) => size.name === "Business Cards")?.manualQuoteMessage).toContain("sent for approval");
    expect(sizes.find((size) => size.name === "5 × 7 Cards")?.maxAutoQuoteQuantity).toBe(200);
    expect(sizes.find((size) => size.name === "Letter")?.manualQuote).toBe(false);
  });

  it("filters finishing by size and removes selections that become incompatible", () => {
    const finishing = [
      { id: "all", active: true, sizeIds: [] },
      { id: "letter", active: true, sizeIds: ["letter"] },
      { id: "legal", active: true, sizeIds: ["legal"] },
      { id: "hidden", active: false, sizeIds: [] },
    ];
    expect(finishingForSize(finishing, "letter").map((option) => option.id)).toEqual(["all", "letter"]);
    expect(compatibleFinishingIds(finishing, "legal", ["all", "letter", "legal", "hidden"])).toEqual(["all", "legal"]);
  });
});
