import type { BillingUnit, Catalog, ChargeBasis, QuantityBasis } from "./types";

/** Owner-editable draft shapes shared by the portal UI and its preview. */
export type PaperDraft = {
  id?: string;
  name: string;
  weight: string | null;
  category: string | null;
  active: boolean;
  sort_order: number;
};

export type SizePaperDraft = {
  material_id: string;
  surcharge: string | null;
  is_standard: boolean;
  active: boolean;
};

export type SizeDraft = {
  id?: string;
  product_id?: string;
  name: string;
  dimensions: string | null;
  base_price: string | null;
  billing_unit: BillingUnit;
  minimum_quantity: number;
  max_auto_quote_quantity: number | null;
  manual_quote: boolean;
  manual_quote_message: string | null;
  included_note: string | null;
  active: boolean;
  sort_order: number;
  papers: SizePaperDraft[];
};

export type FinishingDraft = {
  id?: string;
  name: string;
  information_text: string | null;
  image_alt: string | null;
  image_url: string | null;
  unit_price: string | null;
  charge_basis: ChargeBasis;
  size_ids: string[];
  active: boolean;
  sort_order: number;
};

export type BulkTierDraft = {
  id?: string;
  min_quantity: number;
  unit_price: string | null;
  discount_percent: string | null;
  quantity_basis: QuantityBasis;
  material_id: string | null;
  color_mode: "color" | "black-white" | null;
  sides: 1 | 2 | null;
  size_ids: string[];
  active: boolean;
  sort_order: number;
};

export type PricingDraftState = {
  papers: PaperDraft[];
  sizes: SizeDraft[];
  finishing: FinishingDraft[];
  bulkTiers: BulkTierDraft[];
  minimumOrderTotal: string;
  modeAdjustments: Catalog["modeAdjustments"];
};

/**
 * Projects unsaved owner edits into the same Catalog the public form uses, so the
 * portal preview and the customer quote always run one calculation.
 */
export function draftToCatalog(draft: PricingDraftState): Catalog {
  return {
    fixtureMode: false,
    placeholderNotice: null,
    minimumOrderTotal: draft.minimumOrderTotal,
    modeAdjustments: draft.modeAdjustments,
    papers: draft.papers.filter((paper) => paper.id).map((paper) => ({
      id: paper.id!, name: paper.name, weight: paper.weight, category: paper.category, active: paper.active,
    })),
    products: [{
      id: "draft-preview",
      name: "Print products",
      description: "",
      active: true,
      minimumQuantity: 1,
      sizes: draft.sizes.filter((size) => size.id).map((size) => ({
        id: size.id!,
        name: size.name,
        dimensions: size.dimensions,
        active: size.active,
        custom: size.name.trim().toLowerCase() === "custom",
        basePrice: size.base_price,
        billingUnit: size.billing_unit,
        minimumQuantity: size.minimum_quantity,
        maxAutoQuoteQuantity: size.max_auto_quote_quantity,
        manualQuote: size.manual_quote,
        manualQuoteMessage: size.manual_quote_message,
        includedNote: size.included_note,
        papers: size.papers.map((link) => {
          const paper = draft.papers.find((item) => item.id === link.material_id);
          return {
            materialId: link.material_id,
            name: paper?.name ?? "Paper",
            weight: paper?.weight ?? null,
            category: paper?.category ?? null,
            surcharge: link.surcharge,
            isStandard: link.is_standard,
            active: link.active && Boolean(paper?.active),
          };
        }),
      })),
    }],
    finishing: draft.finishing.filter((option) => option.id).map((option) => ({
      id: option.id!, name: option.name, informationText: option.information_text,
      imageAlt: option.image_alt, imageUrl: option.image_url,
      unitPrice: option.unit_price, chargeBasis: option.charge_basis,
      sizeIds: option.size_ids, active: option.active,
    })),
    bulkTiers: draft.bulkTiers.map((tier, index) => ({
      id: tier.id ?? `draft-${index}`,
      minQuantity: tier.min_quantity,
      unitPrice: tier.unit_price,
      discountPercent: tier.discount_percent,
      quantityBasis: tier.quantity_basis,
      materialId: tier.material_id,
      colorMode: tier.color_mode,
      sides: tier.sides,
      sizeIds: tier.size_ids,
      active: tier.active,
    })),
  };
}
