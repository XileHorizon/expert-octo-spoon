import { minimumForSize } from "./catalog";
import type { EmailAttachment, EmailResult } from "./email";
import { priceQuote } from "./pricing";
import { formatCustomerConfirmation, formatQuoteEmail, formatQuoteEmailHtml, type EmailBusinessSettings } from "./quote-email";
import type { Catalog, DeliveryType, QuotePrice } from "./types";
import type { QuoteRequestInput } from "./validation";

export type ExistingQuote = {
  id: string;
  status: string;
  shopDeliveryStatus?: EmailResult["status"] | null;
};

export type DeliveryAuditIds = {
  shopNotification: string;
  customerConfirmation: string;
};

export type QuoteSnapshot = {
  requestId: string;
  payload: QuoteRequestInput;
  catalog: Catalog;
  pricing: QuotePrice;
  files: File[];
  shopRecipient: string | null;
};

export type QuoteSubmissionDependencies = {
  createRequestId: () => string;
  loadCatalog: () => Promise<Catalog>;
  findExisting: (idempotencyKey: string) => Promise<ExistingQuote | null>;
  persist: (snapshot: QuoteSnapshot) => Promise<{ kind: "created"; audits: DeliveryAuditIds } | { kind: "duplicate"; quote: ExistingQuote }>;
  resolveNotificationRecipient: () => Promise<string | null | undefined>;
  loadBusinessSettings: () => Promise<EmailBusinessSettings>;
  deliver: (input: {
    requestId: string;
    customerEmail: string;
    recipient?: string | null;
    summary: string;
    html: string;
    attachments: EmailAttachment[];
  }) => Promise<EmailResult>;
  deliverCustomerConfirmation: (input: { requestId: string; customerEmail: string; text: string; html: string }) => Promise<EmailResult>;
  recordDelivery: (requestId: string, auditId: string, result: EmailResult) => Promise<void>;
  cleanupAcceptedArtwork: (requestId: string) => Promise<void>;
};

export type QuoteSubmissionResult =
  | { kind: "accepted"; requestId: string; pricing: QuotePrice; email: EmailResult; customerConfirmation: EmailResult }
  | { kind: "duplicate"; requestId: string; status: string; shopDeliveryStatus?: EmailResult["status"] | null }
  | { kind: "invalid"; error: string }
  | { kind: "delivery_failed"; requestId: string; pricing: QuotePrice; email: EmailResult }
  | { kind: "audit_reconciliation_required"; requestId: string; pricing: QuotePrice; deliveryType: DeliveryType; email: EmailResult };

export function catalogSelectionProblem(payload: QuoteRequestInput, catalog: Catalog) {
  for (const job of payload.jobs) {
    const product = catalog.products.find((item) => item.id === job.productId && item.active);
    const size = product?.sizes.find((item) => item.id === job.sizeId && item.active);
    const material = size?.papers.find((item) => item.materialId === job.materialId && item.active);
    if (!product || !size || !material || job.quantity < minimumForSize(size, product.minimumQuantity)) {
      return "A catalog selection is unavailable or below its minimum quantity.";
    }
    if (size.custom && (!job.customWidth || !job.customHeight || !job.customUnits)) {
      return "Custom width, height, and units are required.";
    }
  }
  return null;
}

/** Deterministic orchestration after multipart/schema/file-security validation. */
export async function submitQuote(
  input: { payload: QuoteRequestInput; files: File[]; attachments: EmailAttachment[] },
  dependencies: QuoteSubmissionDependencies,
): Promise<QuoteSubmissionResult> {
  const existing = await dependencies.findExisting(input.payload.idempotencyKey);
  if (existing) {
    return {
      kind: "duplicate",
      requestId: existing.id,
      status: existing.status,
      ...(existing.shopDeliveryStatus !== undefined ? { shopDeliveryStatus: existing.shopDeliveryStatus } : {}),
    };
  }

  const catalog = await dependencies.loadCatalog();
  const problem = catalogSelectionProblem(input.payload, catalog);
  if (problem) return { kind: "invalid", error: problem };

  const pricing = priceQuote(input.payload.jobs, catalog);
  const requestId = dependencies.createRequestId();
  const recipient = await dependencies.resolveNotificationRecipient();
  const persisted = await dependencies.persist({
    requestId,
    payload: input.payload,
    catalog,
    pricing,
    files: input.files,
    shopRecipient: recipient ?? null,
  });
  if (persisted.kind === "duplicate") {
    return {
      kind: "duplicate",
      requestId: persisted.quote.id,
      status: persisted.quote.status,
      ...(persisted.quote.shopDeliveryStatus !== undefined ? { shopDeliveryStatus: persisted.quote.shopDeliveryStatus } : {}),
    };
  }

  const business = await dependencies.loadBusinessSettings();
  const summary = formatQuoteEmail({ requestId, payload: input.payload, pricing, catalog, business });
  const html = formatQuoteEmailHtml(summary);
  const email = await dependencies.deliver({ requestId, customerEmail: input.payload.customer.email, recipient, summary, html, attachments: input.attachments });
  try {
    await dependencies.recordDelivery(requestId, persisted.audits.shopNotification, email);
  } catch {
    if (email.status === "provider_accepted") await dependencies.cleanupAcceptedArtwork(requestId).catch(() => undefined);
    return { kind: "audit_reconciliation_required", requestId, pricing, deliveryType: "shop_notification", email };
  }

  if (email.status !== "provider_accepted") {
    return { kind: "delivery_failed", requestId, pricing, email };
  }

  const confirmationText = formatCustomerConfirmation({ requestId, payload: input.payload, pricing, catalog, business });
  const customerConfirmation = await dependencies.deliverCustomerConfirmation({
    requestId, customerEmail: input.payload.customer.email, text: confirmationText, html: formatQuoteEmailHtml(confirmationText),
  });
  try {
    await dependencies.recordDelivery(requestId, persisted.audits.customerConfirmation, customerConfirmation);
  } catch {
    await dependencies.cleanupAcceptedArtwork(requestId).catch(() => undefined);
    return { kind: "audit_reconciliation_required", requestId, pricing, deliveryType: "customer_confirmation", email: customerConfirmation };
  }
  await dependencies.cleanupAcceptedArtwork(requestId);
  return { kind: "accepted", requestId, pricing, email, customerConfirmation };
}
