export type Money = string;

export type BillingUnit = "printed_page" | "piece" | "card" | "job";
export type ChargeBasis = "per_piece" | "per_printed_page" | "flat_per_job";
export type QuantityBasis = "printed_pages" | "pieces";
export type RequestStatus = "request_received" | "quote_sent" | "in_progress" | "awaiting_payment" | "fulfilled";
export type DeliveryType = "shop_notification" | "customer_confirmation";

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  request_received: "Request received",
  quote_sent: "Quote sent",
  in_progress: "In progress",
  awaiting_payment: "Awaiting payment",
  fulfilled: "Fulfilled",
};

export const BILLING_UNIT_LABELS: Record<BillingUnit, string> = {
  printed_page: "Per printed page",
  piece: "Per piece",
  card: "Per card",
  job: "Flat per job",
};

export const CHARGE_BASIS_LABELS: Record<ChargeBasis, string> = {
  per_piece: "Per piece",
  per_printed_page: "Per printed page",
  flat_per_job: "Flat per job",
};

export const QUANTITY_BASIS_LABELS: Record<QuantityBasis, string> = {
  printed_pages: "Printed pages",
  pieces: "Pieces",
};

/** A paper offered on one size, priced as a surcharge over the size base price. */
export type SizePaper = {
  materialId: string;
  name: string;
  weight: string | null;
  category: string | null;
  /** Null means this paper needs a manual quote on this size. */
  surcharge: Money | null;
  isStandard: boolean;
  active: boolean;
};

export type BulkTier = {
  id?: string;
  minQuantity: number;
  discountPercent: Money | null;
  quantityBasis: QuantityBasis;
  /** Empty means the threshold applies to every size. */
  sizeIds: string[];
  active: boolean;
};

/** Paper catalog entry. Weight is descriptive only; pricing lives on the size. */
export type Material = {
  id: string;
  name: string;
  weight: string | null;
  category: string | null;
  active: boolean;
};

export type SizeOption = {
  id: string;
  name: string;
  dimensions: string | null;
  active: boolean;
  custom?: boolean;
  basePrice: Money | null;
  billingUnit: BillingUnit;
  minimumQuantity: number;
  manualQuote: boolean;
  includedNote: string | null;
  papers: SizePaper[];
};

export type Product = {
  id: string;
  name: string;
  description: string;
  active: boolean;
  minimumQuantity: number;
  sizes: SizeOption[];
};

export type FinishingOption = {
  id: string;
  name: string;
  unitPrice: Money | null;
  chargeBasis: ChargeBasis;
  /** Empty means the option applies to every size. */
  sizeIds: string[];
  active: boolean;
};

export type Catalog = {
  products: Product[];
  papers: Material[];
  finishing: FinishingOption[];
  bulkTiers: BulkTier[];
  /** Quote-wide floor applied only when every job is automatically priced. */
  minimumOrderTotal: Money;
  /** Optional surcharge per size billing unit for each selected production mode. */
  modeAdjustments: {
    color: Money;
    blackWhite: Money;
    portrait: Money;
    landscape: Money;
  };
  fixtureMode: boolean;
  placeholderNotice: string | null;
};

export type QuoteJobInput = {
  clientId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  pageCount: number | null;
  productId: string;
  sizeId: string;
  materialId: string;
  customWidth?: string;
  customHeight?: string;
  customUnits?: "in" | "cm" | "mm";
  quantity: number;
  sides: 1 | 2;
  colorMode: "color" | "black-white";
  orientation: "portrait" | "landscape";
  finishingIds: string[];
  notes?: string;
};

export type PriceLine = { label: string; amount: Money };

export type JobPrice = {
  status: "priced" | "manual";
  subtotal: Money | null;
  reason: string | null;
  lines: PriceLine[];
  discountPercent: Money | null;
};

export type QuotePrice = {
  status: "priced" | "manual";
  /** Complete total only when every item is priced. */
  total: Money | null;
  /** Sum of priced items, even when other items need manual pricing. */
  pricedSubtotal: Money;
  /** Complete pre-adjustment subtotal only when every item is priced. */
  subtotal: Money | null;
  /** Quote-wide minimum adjustment; null when disabled or not applicable. */
  minimumOrderAdjustment: Money | null;
  /** Quote-wide lines shown after the item subtotals. */
  lines: PriceLine[];
  items: JobPrice[];
};
