import { z } from "zod";
import Decimal from "decimal.js";

export const adminTableSchema = z.enum(["products", "sizes", "materials", "bulk_tiers", "finishing_options"]);
export type AdminTable = z.infer<typeof adminTableSchema>;

const money = z.string().regex(/^\d+(\.\d{1,4})?$/, "Use a positive amount with up to four decimal places.").nullable();
const percent = z.string().regex(/^\d+(\.\d{1,2})?$/, "Use a percentage between 0 and 100.")
  .refine((value) => Number(value) >= 0 && Number(value) <= 100, "Use a percentage between 0 and 100.")
  .nullable();
const optionalText = z.string().trim().max(120).nullable();

export const billingUnitSchema = z.enum(["printed_page", "piece", "card", "job"]);
export const chargeBasisSchema = z.enum(["per_piece", "per_printed_page", "flat_per_job"]);
export const quantityBasisSchema = z.enum(["printed_pages", "pieces"]);

/** One paper offered on one size. Null surcharge means a manual quote. */
export const sizePaperSchema = z.object({
  material_id: z.string().uuid(),
  surcharge: money,
  is_standard: z.boolean(),
  active: z.boolean(),
}).strict();

export const paperDraftSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Give the paper a name.").max(120),
  weight: optionalText,
  category: optionalText,
  active: z.boolean(),
  sort_order: z.number().int().min(0).max(100_000),
}).strict();

export const sizeDraftSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Give the size a name.").max(120),
  dimensions: optionalText,
  base_price: money,
  billing_unit: billingUnitSchema,
  minimum_quantity: z.number().int().min(1, "Minimum quantity must be at least 1.").max(1_000_000),
  manual_quote: z.boolean(),
  included_note: z.string().trim().max(300).nullable(),
  active: z.boolean(),
  sort_order: z.number().int().min(0).max(100_000),
  papers: z.array(sizePaperSchema).max(200),
}).strict().superRefine((size, ctx) => {
  if (!size.manual_quote && size.base_price === null) {
    ctx.addIssue({ code: "custom", path: ["base_price"], message: `Set a base price for ${size.name} or mark it as a manual quote.` });
  }
  if (size.papers.filter((paper) => paper.is_standard && paper.active).length > 1) {
    ctx.addIssue({ code: "custom", path: ["papers"], message: `${size.name} can only have one standard paper.` });
  }
  const ids = size.papers.map((paper) => paper.material_id);
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: "custom", path: ["papers"], message: `${size.name} lists the same paper twice.` });
  }
});

export const finishingDraftSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Give the option a name.").max(120),
  unit_price: money,
  charge_basis: chargeBasisSchema,
  size_ids: z.array(z.string().uuid()).max(200),
  active: z.boolean(),
  sort_order: z.number().int().min(0).max(100_000),
}).strict();

export const bulkTierDraftSchema = z.object({
  id: z.string().uuid().optional(),
  min_quantity: z.number().int().min(1, "Thresholds start at 1.").max(10_000_000),
  discount_percent: percent,
  quantity_basis: quantityBasisSchema,
  size_ids: z.array(z.string().uuid()).max(200),
  active: z.boolean(),
  sort_order: z.number().int().min(0).max(100_000),
}).strict();

/** One atomic owner save. Everything succeeds together or nothing changes. */
export const pricingDraftSchema = z.object({
  papers: z.array(paperDraftSchema).max(200),
  sizes: z.array(sizeDraftSchema).max(200),
  finishing: z.array(finishingDraftSchema).max(200),
  bulk_tiers: z.array(bulkTierDraftSchema).max(200),
  minimum_order_total: z.string().regex(/^\d+(\.\d{1,2})?$/).default("0.00"),
  mode_adjustments: z.object({
    color: money.unwrap(),
    black_white: money.unwrap(),
    portrait: money.unwrap(),
    landscape: money.unwrap(),
  }).strict().default({ color: "0", black_white: "0", portrait: "0", landscape: "0" }),
}).strict().superRefine((draft, ctx) => {
  const paperIds = new Set(draft.papers.filter((paper) => paper.id).map((paper) => paper.id));
  for (const size of draft.sizes) {
    for (const paper of size.papers) {
      if (!paperIds.has(paper.material_id)) {
        ctx.addIssue({ code: "custom", path: ["sizes"], message: `${size.name} references a paper that no longer exists.` });
      }
    }
  }
  const thresholds = draft.bulk_tiers.filter((tier) => tier.active).map((tier) => `${tier.quantity_basis}:${tier.min_quantity}`);
  if (new Set(thresholds).size !== thresholds.length) {
    ctx.addIssue({ code: "custom", path: ["bulk_tiers"], message: "Two active thresholds start at the same quantity." });
  }
});

export type PricingDraft = z.infer<typeof pricingDraftSchema>;

export const requestStatusSchema = z.enum(["request_received", "quote_sent", "in_progress", "awaiting_payment", "fulfilled"]);

export const businessSettingsSchema = z.object({
  contact_phone: z.string().trim().min(1).max(40),
  contact_email: z.string().email().max(254),
  turnaround_intro: z.string().trim().min(1).max(500),
  standard_turnaround: z.string().trim().min(1).max(100),
  rush_turnaround: z.string().trim().min(1).max(100),
  support_copy: z.string().trim().min(1).max(200),
  notification_target: z.string().email().max(254).nullable(),
  minimum_order_total: z.string()
    .regex(/^\d+(\.\d{1,2})?$/, "Use a non-negative amount with up to two decimal places.")
    .refine((value) => {
      try { return new Decimal(value).lessThanOrEqualTo("999999999999.99"); } catch { return false; }
    }, "Minimum order total is too large."),
  color_adjustment: money.unwrap(),
  black_white_adjustment: money.unwrap(),
  portrait_adjustment: money.unwrap(),
  landscape_adjustment: money.unwrap(),
}).strict();

export type BusinessSettings = z.infer<typeof businessSettingsSchema>;
export const defaultBusinessSettings: BusinessSettings = {
  contact_phone: "(614) 459-1205",
  contact_email: "support@shipprintesell.com",
  turnaround_intro: "Our certified print specialists review every file and respond with custom pricing modifications within one business day.",
  standard_turnaround: "3-5 Business Days",
  rush_turnaround: "1-2 Business Days",
  support_copy: "Need help?",
  notification_target: null,
  minimum_order_total: "0.00",
  color_adjustment: "0.0000",
  black_white_adjustment: "0.0000",
  portrait_adjustment: "0.0000",
  landscape_adjustment: "0.0000",
};
