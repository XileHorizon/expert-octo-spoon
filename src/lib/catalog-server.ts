import { getSeedCatalog } from "./catalog";
import { isDatabaseConfigured, queryRows } from "./db";
import type { BillingUnit, Catalog, ChargeBasis, QuantityBasis } from "./types";

type ProductRow = { id: string; name: string; description: string | null; active: boolean; minimum_quantity: number };
type SizeRow = {
  id: string; product_id: string; name: string; active: boolean; dimensions: string | null;
  base_price: string | null; billing_unit: BillingUnit; minimum_quantity: number; manual_quote: boolean; included_note: string | null;
};
type MaterialRow = { id: string; name: string; active: boolean; weight: string | null; category: string | null };
type SizePaperRow = { size_id: string; material_id: string; surcharge: string | null; is_standard: boolean; active: boolean };
type TierRow = { id: string; min_quantity: number; discount_percent: string | null; quantity_basis: QuantityBasis; active: boolean };
type FinishingRow = { id: string; name: string; unit_price: string | null; charge_basis: ChargeBasis; active: boolean };

export async function getServerCatalog(): Promise<Catalog> {
  if (!isDatabaseConfigured()) return getSeedCatalog();

  try {
    const [products, sizes, papers, sizePapers, tiers, tierSizes, finishing, finishingSizes] = await Promise.all([
      queryRows<ProductRow>("select id,name,description,active,minimum_quantity from products where active order by sort_order, name"),
      queryRows<SizeRow>("select id,product_id,name,active,dimensions,base_price,billing_unit,minimum_quantity,manual_quote,included_note from sizes where active order by sort_order, name"),
      queryRows<MaterialRow>("select id,name,active,weight,category from materials where active order by sort_order, name"),
      queryRows<SizePaperRow>("select size_id,material_id,surcharge,is_standard,active from size_papers order by sort_order"),
      queryRows<TierRow>("select id,min_quantity,discount_percent,quantity_basis,active from bulk_tiers order by min_quantity"),
      queryRows<{ tier_id: string; size_id: string }>("select tier_id,size_id from bulk_tier_sizes"),
      queryRows<FinishingRow>("select id,name,unit_price,charge_basis,active from finishing_options where active order by sort_order, name"),
      queryRows<{ finishing_id: string; size_id: string }>("select finishing_id,size_id from finishing_sizes"),
    ]);

    if (products.length === 0) return getSeedCatalog();

    return {
      fixtureMode: false,
      placeholderNotice: null,
      papers: papers.map((paper) => ({ id: paper.id, name: paper.name, weight: paper.weight, category: paper.category, active: paper.active })),
      products: products.map((product) => ({
        id: product.id,
        name: product.name,
        description: product.description ?? "",
        active: product.active,
        minimumQuantity: product.minimum_quantity,
        sizes: sizes.filter((size) => size.product_id === product.id).map((size) => ({
          id: size.id,
          name: size.name,
          dimensions: size.dimensions,
          active: size.active,
          custom: size.name.trim().toLowerCase() === "custom",
          basePrice: size.base_price,
          billingUnit: size.billing_unit,
          minimumQuantity: size.minimum_quantity,
          manualQuote: size.manual_quote,
          includedNote: size.included_note,
          papers: sizePapers.filter((link) => link.size_id === size.id).map((link) => {
            const paper = papers.find((item) => item.id === link.material_id);
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
      })),
      bulkTiers: tiers.map((tier) => ({
        id: tier.id,
        minQuantity: tier.min_quantity,
        discountPercent: tier.discount_percent,
        quantityBasis: tier.quantity_basis,
        sizeIds: tierSizes.filter((link) => link.tier_id === tier.id).map((link) => link.size_id),
        active: tier.active,
      })),
      finishing: finishing.map((option) => ({
        id: option.id,
        name: option.name,
        unitPrice: option.unit_price,
        chargeBasis: option.charge_basis,
        sizeIds: finishingSizes.filter((link) => link.finishing_id === option.id).map((link) => link.size_id),
        active: option.active,
      })),
    };
  } catch {
    // A database outage must not expose fixture pricing as if it were real.
    return { ...getSeedCatalog(), products: [], papers: [], finishing: [], bulkTiers: [], placeholderNotice: "The catalog is temporarily unavailable. Please try again shortly." };
  }
}
