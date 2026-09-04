import { z } from "zod";

export const MAX_FILES = 10;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
/** Raw file bytes across the request. Email validation below also accounts for MIME/base64 overhead. */
export const MAX_TOTAL_BYTES = 75 * 1024 * 1024;
/** Conservative default accepted by many SMTP/mailbox combinations; owner may lower it, never silently raise it. */
export const DEFAULT_MAX_EMAIL_BYTES = 110 * 1024 * 1024;
export const ALLOWED_MIME_TYPES = new Set(["application/pdf", "image/png", "image/jpeg"]);

/** Base64 expands bytes 4/3, line wrapping adds ~2.6%, plus bounded headers/body overhead. */
export function estimateEncodedEmailBytes(fileBytes: number, fileCount: number, bodyBytes = 32 * 1024) {
  const base64 = Math.ceil(fileBytes / 3) * 4;
  const lineWrapping = Math.ceil(base64 / 76) * 2;
  const perAttachmentHeaders = fileCount * 2048;
  return base64 + lineWrapping + perAttachmentHeaders + bodyBytes;
}

export function maxRawBytesForEmail(maxEmailBytes: number, fileCount: number) {
  let low = 0, high = MAX_TOTAL_BYTES;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (estimateEncodedEmailBytes(middle, fileCount) <= maxEmailBytes) low = middle;
    else high = middle - 1;
  }
  return low;
}

export function configuredMaxEmailBytes() {
  const raw = Number(process.env.MAX_EMAIL_MESSAGE_BYTES ?? DEFAULT_MAX_EMAIL_BYTES);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MAX_EMAIL_BYTES;
}

export function uploadLimitProblem(fileBytes: number, fileCount: number, maxEmailBytes = configuredMaxEmailBytes()) {
  if (fileBytes > MAX_TOTAL_BYTES) return "Combined files exceed the upload limit.";
  if (estimateEncodedEmailBytes(fileBytes, fileCount) > maxEmailBytes) {
    return "The files would exceed the email attachment limit after encoding. Reduce the submission size or contact the shop for another transfer method.";
  }
  return null;
}

export const jobSchema = z.object({
  clientId: z.string().min(1).max(100),
  fileName: z.string().min(1).max(255),
  fileSize: z.number().int().min(1).max(MAX_FILE_BYTES),
  mimeType: z.string().refine((value) => ALLOWED_MIME_TYPES.has(value), "Unsupported file type"),
  pageCount: z.number().int().min(1).max(10000).nullable(),
  productId: z.string().min(1).max(100),
  sizeId: z.string().min(1).max(100),
  materialId: z.string().min(1).max(100),
  customWidth: z.string().regex(/^\d+(\.\d{1,3})?$/).optional(),
  customHeight: z.string().regex(/^\d+(\.\d{1,3})?$/).optional(),
  customUnits: z.enum(["in", "cm", "mm"]).optional(),
  quantity: z.number().int().min(1).max(1_000_000),
  sides: z.union([z.literal(1), z.literal(2)]),
  colorMode: z.enum(["color", "black-white"]),
  orientation: z.enum(["portrait", "landscape"]),
  finishingIds: z.array(z.string().min(1).max(100)).max(20),
  notes: z.string().trim().max(2000).optional(),
}).superRefine((job, context) => {
  if (job.sizeId.includes("custom") && (!job.customWidth || !job.customHeight || !job.customUnits)) {
    context.addIssue({ code: "custom", message: "Custom width, height, and units are required.", path: ["customWidth"] });
  }
});

export const quoteRequestSchema = z.object({
  idempotencyKey: z.string().uuid(),
  customer: z.object({
    name: z.string().trim().min(1).max(120),
    email: z.string().email().max(254),
    organization: z.string().trim().max(160).optional(),
    phone: z.string().trim().max(40).optional(),
  }),
  jobs: z.array(jobSchema).min(1).max(MAX_FILES),
}).superRefine((value, context) => {
  const total = value.jobs.reduce((sum, job) => sum + job.fileSize, 0);
  const problem = uploadLimitProblem(total, value.jobs.length);
  if (problem) context.addIssue({ code: "custom", message: problem, path: ["jobs"] });
});

export type QuoteRequestInput = z.infer<typeof quoteRequestSchema>;
