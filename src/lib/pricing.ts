import Decimal from "decimal.js";
import type { BulkTier, Catalog, JobPrice, PriceLine, QuoteJobInput, QuotePrice, SizeOption } from "./types";

Decimal.set({ precision: 24, rounding: Decimal.ROUND_HALF_UP });
const money = (value: Decimal) => value.toDecimalPlaces(2).toFixed(2);

/** Printed pages billed for one job: pieces x pages per piece x printed sides. */
export function printedPages(job: QuoteJobInput) {
  return Math.max(job.quantity, 0) * Math.max(job.pageCount ?? 1, 1) * job.sides;
}

export function billableUnits(job: QuoteJobInput, size: SizeOption) {
  if (size.billingUnit === "job") return 1;
  if (size.billingUnit === "printed_page") return printedPages(job);
  return Math.max(job.quantity, 0);
}

function manual(reason: string): JobPrice {
  return { status: "manual", subtotal: null, reason, lines: [], discountPercent: null };
}

function tierQuantity(tier: BulkTier, job: QuoteJobInput) {
  return tier.quantityBasis === "pieces" ? Math.max(job.quantity, 0) : printedPages(job);
}

function tierMatches(tier: BulkTier, job: QuoteJobInput, sizeId: string) {
  return tier.active
    && (tier.sizeIds.length === 0 || tier.sizeIds.includes(sizeId))
    && (!tier.materialId || tier.materialId === job.materialId)
    && (!tier.colorMode || tier.colorMode === job.colorMode)
    && (!tier.sides || tier.sides === job.sides)
    && tierQuantity(tier, job) >= tier.minQuantity;
}

function tierSpecificity(tier: BulkTier) {
  return Number(Boolean(tier.materialId)) + Number(Boolean(tier.colorMode)) + Number(Boolean(tier.sides));
}

/** Highest qualifying threshold wins; ties prefer the most specifically scoped rule. */
function bestTier(tiers: BulkTier[]) {
  return [...tiers].sort((a, b) => b.minQuantity - a.minQuantity || tierSpecificity(b) - tierSpecificity(a))[0];
}

export function priceJob(job: QuoteJobInput, catalog: Catalog): JobPrice {
  // Ship Print charges the same price for single- and double-sided selections.
  // Retain the submitted value for production details, but normalize pricing and
  // legacy side-scoped rules to the single-sided path so sides can never add cost.
  const pricedJob: QuoteJobInput = job.sides === 1 ? job : { ...job, sides: 1 };
  const product = catalog.products.find((item) => item.id === job.productId && item.active);
  if (!product) return manual("Product is unavailable.");

  const size = product.sizes.find((item) => item.id === job.sizeId && item.active);
  if (!size) return manual("Choose an available print size.");
  if (size.manualQuote) return manual(size.manualQuoteMessage || `${size.name} is quoted manually by the print team.`);

  const minimum = Math.max(size.minimumQuantity, product.minimumQuantity);
  if (job.quantity < minimum) return manual(`Minimum quantity for ${size.name} is ${minimum}.`);
  if (size.maxAutoQuoteQuantity !== null && size.maxAutoQuoteQuantity !== undefined && job.quantity > size.maxAutoQuoteQuantity) {
    return manual(size.manualQuoteMessage || `Quantities over ${size.maxAutoQuoteQuantity.toLocaleString("en-US")} are quoted manually.`);
  }
  if (size.custom && (!job.customWidth || !job.customHeight || !job.customUnits)) {
    return manual("Custom dimensions require owner review.");
  }

  const paper = size.papers.find((item) => item.materialId === job.materialId && item.active);
  if (!paper) return manual("Selected size and paper are not available together.");

  const units = billableUnits(pricedJob, size);
  if (units <= 0) return manual("Quantity must be greater than zero.");

  const configuredRates = catalog.bulkTiers
    .filter((tier) => tier.active && tier.unitPrice !== null && tier.unitPrice !== undefined)
    .filter((tier) => tier.sizeIds.length === 0 || tier.sizeIds.includes(size.id));
  const rate = bestTier(configuredRates.filter((tier) => tierMatches(tier, pricedJob, size.id)));
  if (configuredRates.length > 0 && !rate) return manual(`A unit rate is not configured for this ${size.name} selection.`);
  if (!rate && size.basePrice === null) return manual("Base pricing for this size is not set yet.");
  if (paper.surcharge === null && !rate?.materialId) return manual("This paper is quoted manually on this size.");

  const lines: PriceLine[] = [];
  const printingRate = new Decimal(rate?.unitPrice ?? size.basePrice!);
  const printing = printingRate.times(units);
  const rateDetail = rate ? ` at $${printingRate.toDecimalPlaces(4).toString()} per ${size.billingUnit.replaceAll("_", " ")}` : "";
  lines.push({ label: `${size.name} printing${rateDetail}`, amount: money(printing) });

  // A material-scoped rate is the complete material-inclusive print rate.
  const paperCharge = new Decimal(rate?.materialId ? 0 : paper.surcharge ?? 0).times(units);
  if (paperCharge.greaterThan(0)) {
    lines.push({ label: `${paper.name} paper`, amount: money(paperCharge) });
  }

  // Exact scoped rates are authoritative and replace legacy global mode adjustments.
  const colorRate = new Decimal(rate ? 0 : job.colorMode === "color" ? catalog.modeAdjustments.color : catalog.modeAdjustments.blackWhite);
  const colorCharge = colorRate.times(units);
  if (!colorCharge.isZero()) {
    lines.push({ label: `${job.colorMode === "color" ? "Full color" : "Black & white"} adjustment`, amount: money(colorCharge) });
  }
  const orientationRate = new Decimal(rate ? 0 : job.orientation === "portrait" ? catalog.modeAdjustments.portrait : catalog.modeAdjustments.landscape);
  const orientationCharge = orientationRate.times(units);
  if (!orientationCharge.isZero()) {
    lines.push({ label: `${job.orientation === "portrait" ? "Portrait" : "Landscape"} adjustment`, amount: money(orientationCharge) });
  }

  // Discounts apply to printing and paper only, never to finishing or setup fees.
  const discountable = printing.plus(paperCharge);
  const pages = printedPages(pricedJob);
  const pieces = Math.max(job.quantity, 0);
  const tier = bestTier(catalog.bulkTiers
    .filter((item) => item.active && item.discountPercent !== null)
    .filter((item) => tierMatches(item, pricedJob, size.id)));

  let discount = new Decimal(0);
  if (tier?.discountPercent) {
    discount = discountable.times(tier.discountPercent).dividedBy(100);
    lines.push({ label: `Bulk discount (${new Decimal(tier.discountPercent).toDecimalPlaces(2).toString()}% off)`, amount: `-${money(discount)}` });
  }

  let total = discountable.minus(discount).plus(colorCharge).plus(orientationCharge);

  for (const id of job.finishingIds) {
    const option = catalog.finishing.find((item) => item.id === id && item.active);
    if (!option) return manual("A selected finishing option is unavailable.");
    if (option.unitPrice === null) return manual(`${option.name} requires manual pricing.`);
    if (option.sizeIds.length > 0 && !option.sizeIds.includes(size.id)) {
      return manual(`${option.name} is not offered for ${size.name}.`);
    }
    const multiplier = option.chargeBasis === "flat_per_job" ? 1 : option.chargeBasis === "per_printed_page" ? pages : pieces;
    const amount = new Decimal(option.unitPrice).times(multiplier);
    lines.push({ label: option.name, amount: money(amount) });
    total = total.plus(amount);
  }

  return { status: "priced", subtotal: money(total), reason: null, lines, discountPercent: tier?.discountPercent ?? null };
}

export function priceQuote(jobs: QuoteJobInput[], catalog: Catalog): QuotePrice {
  const items = jobs.map((job) => priceJob(job, catalog));
  const pricedSubtotal = money(items.reduce((sum, item) => sum.plus(item.subtotal ?? 0), new Decimal(0)));
  const manualItem = items.some((item) => item.status === "manual");
  if (manualItem) {
    return { status: "manual", total: null, pricedSubtotal, subtotal: null, minimumOrderAdjustment: null, lines: [], items };
  }

  const subtotal = new Decimal(pricedSubtotal);
  const minimum = new Decimal(catalog.minimumOrderTotal || 0);
  const adjustment = items.length > 0 && minimum.greaterThan(0) && subtotal.lessThan(minimum) ? minimum.minus(subtotal) : null;
  const lines = adjustment ? [{ label: "Minimum order adjustment", amount: money(adjustment) }] : [];
  return {
    status: "priced",
    total: money(adjustment ? subtotal.plus(adjustment) : subtotal),
    pricedSubtotal,
    subtotal: pricedSubtotal,
    minimumOrderAdjustment: adjustment ? money(adjustment) : null,
    lines,
    items,
  };
}
