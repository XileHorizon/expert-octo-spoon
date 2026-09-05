import type { BillingUnit, Catalog, Material, SizeOption, SizePaper } from "./types";

const PAPERS: (Material & { sizes: string[] })[] = [
  { id: "standard-20", name: "Standard", weight: "20 lb", category: "Uncoated", active: true, sizes: ["letter"] },
  { id: "premium-color-28", name: "Premium Color", weight: "28 lb", category: "Smooth uncoated", active: true, sizes: ["letter"] },
  { id: "gloss-27", name: "Gloss Paper", weight: "27 lb", category: "Gloss coated", active: true, sizes: ["letter"] },
  { id: "cardstock-100", name: "Cardstock", weight: "100 lb", category: "Cover stock", active: true, sizes: ["letter"] },
  { id: "standard-22", name: "Standard", weight: "22 lb", category: "Uncoated", active: true, sizes: ["legal"] },
  { id: "standard-30", name: "Standard", weight: "30 lb", category: "Uncoated", active: true, sizes: ["tabloid"] },
  { id: "cardstock-80", name: "Cardstock", weight: "80 lb", category: "Cover stock", active: true, sizes: ["tabloid"] },
  { id: "poster-18x24-tbc", name: "Paper options to be confirmed", weight: null, category: null, active: true, sizes: ["poster-18x24"] },
  { id: "poster-24x36-tbc", name: "Paper options to be confirmed", weight: null, category: null, active: true, sizes: ["poster-24x36"] },
  { id: "business-card-50", name: "Business card stock", weight: "50 lb", category: "Cover stock", active: true, sizes: ["business-card"] },
  { id: "business-card-100", name: "Business card stock", weight: "100 lb", category: "Cover stock", active: true, sizes: ["business-card"] },
  { id: "custom-tbc", name: "Paper options to be confirmed", weight: null, category: null, active: true, sizes: ["custom"] },
];

const SIZES: { id: string; name: string; dimensions: string; billingUnit: BillingUnit; minimum: number; manual: boolean; custom?: boolean }[] = [
  { id: "letter", name: "Letter", dimensions: "8.5 × 11", billingUnit: "printed_page", minimum: 1, manual: false },
  { id: "legal", name: "Legal", dimensions: "8.5 × 14", billingUnit: "printed_page", minimum: 1, manual: false },
  { id: "tabloid", name: "Tabloid", dimensions: "11 × 17", billingUnit: "printed_page", minimum: 1, manual: false },
  { id: "poster-18x24", name: "Poster", dimensions: "18 × 24", billingUnit: "piece", minimum: 1, manual: true },
  { id: "poster-24x36", name: "Large Poster", dimensions: "24 × 36", billingUnit: "piece", minimum: 1, manual: true },
  { id: "business-card", name: "Business Cards", dimensions: "3.5 × 2", billingUnit: "card", minimum: 200, manual: false },
  { id: "custom", name: "Custom", dimensions: "Custom", billingUnit: "piece", minimum: 1, manual: true, custom: true },
];

/**
 * Required initial size and paper mapping. Prices stay unset unless a development
 * preview is explicitly enabled; production owners set real prices in MySQL.
 */
export function getSeedCatalog(): Catalog {
  const demo = process.env.NEXT_PUBLIC_ENABLE_DEMO_PRICING === "true";
  const demoBase: Record<string, string> = { letter: "0.20", legal: "0.26", tabloid: "0.48", "business-card": "0.18" };
  const demoSurcharge: Record<string, string> = { "premium-color-28": "0.05", "gloss-27": "0.08", "cardstock-100": "0.15" };

  const sizes: SizeOption[] = SIZES.map((size) => {
    const papers: SizePaper[] = PAPERS.filter((paper) => paper.sizes.includes(size.id)).map((paper, index) => ({
      materialId: paper.id,
      name: paper.name,
      weight: paper.weight,
      category: paper.category,
      surcharge: size.manual ? null : demo ? (demoSurcharge[paper.id] ?? "0") : index === 0 ? "0" : null,
      isStandard: index === 0,
      active: true,
    }));
    const standard = papers.find((paper) => paper.isStandard);
    return {
      id: size.id,
      name: size.name,
      dimensions: size.dimensions,
      active: true,
      custom: size.custom,
      basePrice: size.manual ? null : demo ? (demoBase[size.id] ?? null) : null,
      billingUnit: size.billingUnit,
      minimumQuantity: size.minimum,
      manualQuote: size.manual,
      includedNote: standard ? `Included: ${[standard.name, standard.weight].filter(Boolean).join(" ")} paper, black-and-white, single-sided` : null,
      papers,
    };
  });

  return {
    fixtureMode: demo,
    placeholderNotice: "Availability and any displayed demo prices must be confirmed by the owner before launch.",
    papers: PAPERS.map(({ id, name, weight, category, active }) => ({ id, name, weight, category, active })),
    products: [{
      id: "print-products-initial",
      name: "Print products",
      description: "Initial required size and paper mapping.",
      active: true,
      minimumQuantity: 1,
      sizes,
    }],
    finishing: [
      { id: "double-sided", name: "Double-sided printing", unitPrice: demo ? "0.06" : null, chargeBasis: "per_printed_page", sizeIds: ["letter", "legal", "tabloid"], active: true },
      { id: "folding", name: "Folding", unitPrice: demo ? "0.04" : null, chargeBasis: "per_piece", sizeIds: ["letter", "legal", "tabloid"], active: true },
      { id: "binding", name: "Binding", unitPrice: demo ? "3.50" : null, chargeBasis: "flat_per_job", sizeIds: ["letter", "legal"], active: true },
      { id: "file-setup", name: "File setup", unitPrice: demo ? "12.00" : null, chargeBasis: "flat_per_job", sizeIds: [], active: true },
    ],
    bulkTiers: demo
      ? [
          { id: "tier-100", minQuantity: 100, discountPercent: "5", quantityBasis: "printed_pages", sizeIds: ["letter", "legal", "tabloid"], active: true },
          { id: "tier-250", minQuantity: 250, discountPercent: "10", quantityBasis: "printed_pages", sizeIds: ["letter", "legal", "tabloid"], active: true },
          { id: "tier-500", minQuantity: 500, discountPercent: "15", quantityBasis: "printed_pages", sizeIds: ["letter", "legal", "tabloid"], active: true },
        ]
      : [],
  };
}

export function isBusinessCardSize(size: { id: string; name: string } | undefined) {
  return Boolean(size && (size.id === "business-card" || size.name.toLowerCase().includes("business card")));
}

export function minimumForSize(size: { id: string; name: string; minimumQuantity?: number } | undefined, productMinimum = 1) {
  const sizeMinimum = size?.minimumQuantity ?? 1;
  const base = Math.max(sizeMinimum, productMinimum);
  return isBusinessCardSize(size) ? Math.max(200, base) : base;
}
