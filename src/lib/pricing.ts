import Decimal from "decimal.js";
import type { Catalog, JobPrice, PriceLine, QuoteJobInput, QuotePrice, SizeOption } from "./types";

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

export function priceJob(job: QuoteJobInput, catalog: Catalog): JobPrice {
  const product = catalog.products.find((item) => item.id === job.productId && item.active);
  if (!product) return manual("Product is unavailable.");

  const size = product.sizes.find((item) => item.id === job.sizeId && item.active);
  if (!size) return manual("Choose an available print size.");
  if (size.manualQuote) return manual(`${size.name} is quoted manually by the print team.`);

  const minimum = Math.max(size.minimumQuantity, product.minimumQuantity);
  if (job.quantity < minimum) return manual(`Minimum quantity for ${size.name} is ${minimum}.`);
  if (size.custom && (!job.customWidth || !job.customHeight || !job.customUnits)) {
    return manual("Custom dimensions require owner review.");
  }
  if (size.basePrice === null) return manual("Base pricing for this size is not set yet.");

  const paper = size.papers.find((item) => item.materialId === job.materialId && item.active);
  if (!paper) return manual("Selected size and paper are not available together.");
  if (paper.surcharge === null) return manual("This paper is quoted manually on this size.");

  const units = billableUnits(job, size);
  if (units <= 0) return manual("Quantity must be greater than zero.");

  const lines: PriceLine[] = [];
  const printing = new Decimal(size.basePrice).times(units);
  lines.push({ label: `${size.name} printing`, amount: money(printing) });

  const paperCharge = new Decimal(paper.surcharge).times(units);
  if (paperCharge.greaterThan(0)) {
    lines.push({ label: `${paper.name} paper`, amount: money(paperCharge) });
  }

  // Discounts apply to printing and paper only, never to finishing or setup fees.
  const discountable = printing.plus(paperCharge);
  const pages = printedPages(job);
  const pieces = Math.max(job.quantity, 0);
  const tier = catalog.bulkTiers
    .filter((item) => item.active && item.discountPercent !== null)
    .filter((item) => item.sizeIds.length === 0 || item.sizeIds.includes(size.id))
    .filter((item) => (item.quantityBasis === "pieces" ? pieces : pages) >= item.minQuantity)
    .sort((a, b) => Number(b.discountPercent) - Number(a.discountPercent))[0];

  let discount = new Decimal(0);
  if (tier?.discountPercent) {
    discount = discountable.times(tier.discountPercent).dividedBy(100);
    lines.push({ label: `Bulk discount (${new Decimal(tier.discountPercent).toDecimalPlaces(2).toString()}% off)`, amount: `-${money(discount)}` });
  }

  let total = discountable.minus(discount);

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
  return { status: manualItem ? "manual" : "priced", total: manualItem ? null : pricedSubtotal, pricedSubtotal, items };
}
