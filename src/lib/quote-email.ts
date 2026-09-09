import type { Catalog } from "./types";
import type { QuoteRequestInput } from "./validation";

export type EmailBusinessSettings = {
  contactPhone: string;
  contactEmail: string;
  turnaroundIntro: string;
  standardTurnaround: string;
  rushTurnaround: string;
};

const defaultBusiness: EmailBusinessSettings = {
  contactPhone: "", contactEmail: "", turnaroundIntro: "The print team will review your files and follow up.",
  standardTurnaround: "", rushTurnaround: "",
};

function fileSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
}

function money(value: string | null) {
  return value === null ? "Manual quote" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value));
}

export function formatQuoteEmail(input: {
  requestId: string;
  payload: QuoteRequestInput;
  pricing: ReturnType<typeof import("./pricing").priceQuote>;
  catalog: Catalog;
  business?: EmailBusinessSettings;
}) {
  const { requestId, payload, pricing, catalog } = input;
  const business = input.business ?? defaultBusiness;
  const lines = [
    "NEW PRINT QUOTE REQUEST",
    `Reference: ${requestId}`,
    "",
    "CUSTOMER",
    `Name: ${payload.customer.name}`,
    `Email: ${payload.customer.email}`,
    `Organization: ${payload.customer.organization || "Not provided"}`,
    `Phone: ${payload.customer.phone || "Not provided"}`,
    "",
    `ORDER (${payload.jobs.length} ${payload.jobs.length === 1 ? "FILE" : "FILES"})`,
  ];

  payload.jobs.forEach((job, index) => {
    const product = catalog.products.find((item) => item.id === job.productId);
    const size = product?.sizes.find((item) => item.id === job.sizeId);
    const material = size?.papers.find((item) => item.materialId === job.materialId);
    const finishing = job.finishingIds.map((id) => catalog.finishing.find((item) => item.id === id)?.name ?? id);
    const itemPrice = pricing.items[index];
    lines.push(
      "",
      `FILE ${index + 1}`,
      `Original: ${job.fileName}`,
      `File type: ${job.mimeType}`,
      `File size: ${fileSize(job.fileSize)}`,
      `Pages: ${job.pageCount ?? "Unavailable / not applicable"}`,
      `Product: ${product?.name ?? job.productId}`,
      `Finished size: ${size?.name ?? job.sizeId}`,
      `Material: ${material ? [material.name, material.weight].filter(Boolean).join(" ") : job.materialId}`,
      `Quantity: ${job.quantity.toLocaleString("en-US")}`,
      `Printed sides: ${job.sides === 1 ? "Single-sided" : "Double-sided"}`,
      `Ink colorway: ${job.colorMode === "color" ? "Full Color (CMYK)" : "Black & White"}`,
      `Orientation: ${job.orientation === "portrait" ? "Portrait" : "Landscape"}`,
      ...(size?.custom ? [`Custom dimensions: ${job.customWidth} × ${job.customHeight} ${job.customUnits}`] : []),
      `Finishing: ${finishing.length ? finishing.join(", ") : "None selected"}`,
      `Notes: ${job.notes?.trim() || "None"}`,
      `Item pricing: ${itemPrice?.status === "priced" ? money(itemPrice.subtotal) : "Manual quote"}`,
      ...(itemPrice?.status === "priced" && itemPrice.lines.length > 1
        ? ["Breakdown:", ...itemPrice.lines.map((line) => `  - ${line.label}: ${line.amount.startsWith("-") ? `-${money(line.amount.slice(1))}` : money(line.amount)}`)]
        : []),
    );
    if (itemPrice?.reason) lines.push(`Pricing note: ${itemPrice.reason}`);
  });

  lines.push(
    "",
    "SUMMARY",
    `Pricing status: ${pricing.status === "priced" ? "Estimated" : "Manual quote required"}`,
    ...(pricing.status === "manual" && Number(pricing.pricedSubtotal) > 0 ? [`Priced items subtotal: ${money(pricing.pricedSubtotal)}`] : []),
    ...(pricing.status === "priced" && pricing.minimumOrderAdjustment
      ? [`Subtotal: ${money(pricing.subtotal)}`, `Minimum order adjustment: ${money(pricing.minimumOrderAdjustment)}`]
      : []),
    `Estimated total: ${money(pricing.total)}`,
    "",
    "Original customer files are attached to this email when attachment delivery is enabled.",
    "Displayed prices are provisional estimates pending owner review. This request is not yet a final quote or order.",
    "",
    "SHOP CONTACT",
    `Email: ${business.contactEmail || "Not configured"}`,
    `Phone: ${business.contactPhone || "Not configured"}`,
  );
  return lines.join("\n");
}

export function formatCustomerConfirmation(input: {
  requestId: string;
  payload: QuoteRequestInput;
  pricing: ReturnType<typeof import("./pricing").priceQuote>;
  catalog: Catalog;
  business: EmailBusinessSettings;
}) {
  const { requestId, payload, pricing, catalog, business } = input;
  const lines = [
    "YOUR PRINT REQUEST WAS RECEIVED",
    `Reference: ${requestId}`,
    "",
    `Hi ${payload.customer.name},`,
    "",
    "Thank you for your request. The print team received your files and production details for review.",
    "This confirmation is not a final quote, order acceptance, invoice, or production commitment.",
    "",
    "REQUEST SUMMARY",
    `Files: ${payload.jobs.length}`,
  ];
  payload.jobs.forEach((job, index) => {
    const product = catalog.products.find((item) => item.id === job.productId);
    const size = product?.sizes.find((item) => item.id === job.sizeId);
    const material = size?.papers.find((item) => item.materialId === job.materialId);
    const item = pricing.items[index];
    lines.push(`${index + 1}. ${job.fileName} — ${product?.name ?? "Print job"}; ${size?.name ?? "custom size"}; ${material?.name ?? "material review"}; ${job.quantity.toLocaleString("en-US")} qty; ${job.colorMode === "color" ? "full color" : "black & white"}; ${job.orientation} — ${item?.status === "priced" ? `provisional ${money(item.subtotal)}` : "manual pricing"}`);
  });
  lines.push(
    "",
    "PRICING",
    pricing.status === "priced"
      ? `Provisional estimate: ${money(pricing.total)}. Final pricing follows file and specification review.`
      : "Manual pricing is required. The shop will review the request before sending a final quote.",
    "",
    "WHAT HAPPENS NEXT",
    business.turnaroundIntro,
    ...(business.standardTurnaround ? [`Standard turnaround: ${business.standardTurnaround}`] : []),
    ...(business.rushTurnaround ? [`Rush turnaround: ${business.rushTurnaround}`] : []),
    "",
    "CONTACT",
    `Email: ${business.contactEmail || "Reply to this email"}`,
    ...(business.contactPhone ? [`Phone: ${business.contactPhone}`] : []),
    "",
    "For security and inbox size, your original files are not attached to this confirmation.",
  );
  return lines.join("\n");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

/** Email-client-safe HTML generated from the canonical plain-text summary. */
export function formatQuoteEmailHtml(summary: string) {
  const lines = summary.split("\n");
  const title = escapeHtml(lines.shift() || "NEW PRINT QUOTE REQUEST");
  const body = lines.map((line) => {
    if (!line) return '<tr><td style="height:10px;line-height:10px;font-size:1px">&nbsp;</td></tr>';
    const escaped = escapeHtml(line.trim());
    if (/^(CUSTOMER|ORDER \(.*\)|FILE \d+|SUMMARY|SHOP CONTACT|REQUEST SUMMARY|PRICING|WHAT HAPPENS NEXT|CONTACT)$/.test(line.trim())) {
      return `<tr><td style="padding:18px 0 7px;color:#1d4ed8;font-family:Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase">${escaped}</td></tr>`;
    }
    if (/^\s+- /.test(line)) {
      return `<tr><td style="padding:2px 0 2px 16px;color:#475569;font-family:Arial,sans-serif;font-size:14px;line-height:21px">&bull;&nbsp; ${escapeHtml(line.trim().slice(2))}</td></tr>`;
    }
    const separator = line.indexOf(":");
    if (separator > 0) {
      const label = escapeHtml(line.slice(0, separator));
      const value = escapeHtml(line.slice(separator + 1).trim());
      return `<tr><td style="padding:4px 0;font-family:Arial,sans-serif;font-size:14px;line-height:21px"><span style="color:#64748b">${label}:</span> <strong style="color:#0f172a;font-weight:600">${value}</strong></td></tr>`;
    }
    return `<tr><td style="padding:4px 0;color:#475569;font-family:Arial,sans-serif;font-size:14px;line-height:21px">${escaped}</td></tr>`;
  }).join("");

  return `<!doctype html><html><body style="margin:0;padding:0;background:#f1f5f9"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f1f5f9"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:640px;background:#ffffff;border:1px solid #dbe3ee;border-radius:10px"><tr><td style="padding:24px 28px;background:#0f172a;border-radius:10px 10px 0 0"><div style="color:#93c5fd;font-family:Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:1.4px">SHIP PRINT eSELL</div><h1 style="margin:7px 0 0;color:#ffffff;font-family:Arial,sans-serif;font-size:23px;line-height:30px">${title}</h1></td></tr><tr><td style="padding:18px 28px 28px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${body}</table></td></tr></table></td></tr></table></body></html>`;
}
