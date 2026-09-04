import type { Catalog } from "./types";
import type { QuoteRequestInput } from "./validation";

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
}) {
  const { requestId, payload, pricing, catalog } = input;
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
    `Estimated total: ${money(pricing.total)}`,
    "",
    "Original customer files are attached to this email when attachment delivery is enabled.",
    "Displayed prices are estimates pending owner review.",
  );
  return lines.join("\n");
}
