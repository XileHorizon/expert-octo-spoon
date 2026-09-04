import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getServerCatalog } from "@/lib/catalog-server";
import { minimumForSize } from "@/lib/catalog";
import { isDatabaseConfigured, query, queryOne, transaction } from "@/lib/db";
import { sendQuoteNotification } from "@/lib/email";
import { priceQuote } from "@/lib/pricing";
import { formatQuoteEmail } from "@/lib/quote-email";
import { cleanupLocalArtwork, findLocalRequestByIdempotencyKey, saveLocalRequest, updateLocalEmailStatus } from "@/lib/local-intake";
import { ALLOWED_MIME_TYPES, MAX_FILE_BYTES, quoteRequestSchema, uploadLimitProblem } from "@/lib/validation";

export const runtime = "nodejs";

async function signatureMatches(file: File) {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (file.type === "application/pdf") return String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-";
  if (file.type === "image/png") return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (file.type === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return false;
}

export async function POST(request: Request) {
  const databaseReady = isDatabaseConfigured();
  const localDevIntake = !databaseReady && process.env.NODE_ENV !== "production" && process.env.ENABLE_LOCAL_DEV_INTAKE === "true";
  if (!databaseReady && !localDevIntake) return NextResponse.json({ error: "Quote intake is not configured yet." }, { status: 503 });

  let form: FormData;
  try { form = await request.formData(); } catch { return NextResponse.json({ error: "Invalid form data." }, { status: 400 }); }
  const raw = form.get("payload");
  if (typeof raw !== "string") return NextResponse.json({ error: "Missing request payload." }, { status: 400 });
  let parsedJson: unknown;
  try { parsedJson = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid request payload." }, { status: 400 }); }
  const parsed = quoteRequestSchema.safeParse(parsedJson);
  if (!parsed.success) return NextResponse.json({ error: "Please correct the highlighted request details.", issues: parsed.error.flatten() }, { status: 422 });

  const files = form.getAll("files").filter((item): item is File => item instanceof File);
  if (files.length !== parsed.data.jobs.length) return NextResponse.json({ error: "Every job must include one original file." }, { status: 422 });
  const limitProblem = uploadLimitProblem(files.reduce((sum, file) => sum + file.size, 0), files.length);
  if (limitProblem) return NextResponse.json({ error: limitProblem }, { status: 413 });
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]; const job = parsed.data.jobs[index];
    if (file.name !== job.fileName || file.size !== job.fileSize || file.type !== job.mimeType || file.size > MAX_FILE_BYTES || !ALLOWED_MIME_TYPES.has(file.type) || !(await signatureMatches(file))) {
      return NextResponse.json({ error: `File ${index + 1} failed security validation.` }, { status: 422 });
    }
  }

  if (databaseReady) {
    const existing = await queryOne<{ id: string; status: string }>("select id, status from quote_requests where idempotency_key = $1", [parsed.data.idempotencyKey]);
    if (existing) return NextResponse.json({ requestId: existing.id, status: existing.status, duplicate: true });
  } else {
    const existing = await findLocalRequestByIdempotencyKey(parsed.data.idempotencyKey);
    if (existing) return NextResponse.json({ ...existing, duplicate: true });
  }

  const catalog = await getServerCatalog();
  for (const job of parsed.data.jobs) {
    const product = catalog.products.find((item) => item.id === job.productId && item.active);
    const size = product?.sizes.find((item) => item.id === job.sizeId && item.active);
    const material = size?.papers.find((item) => item.materialId === job.materialId && item.active);
    if (!product || !size || !material || job.quantity < minimumForSize(size, product.minimumQuantity)) {
      return NextResponse.json({ error: "A catalog selection is unavailable or below its minimum quantity." }, { status: 422 });
    }
    if (size.custom && (!job.customWidth || !job.customHeight || !job.customUnits)) {
      return NextResponse.json({ error: "Custom width, height, and units are required." }, { status: 422 });
    }
  }

  const pricing = priceQuote(parsed.data.jobs, catalog);
  const attachments = await Promise.all(files.map(async (file) => ({ filename: file.name, contentType: file.type, content: Buffer.from(await file.arrayBuffer()) })));

  if (!databaseReady) {
    const requestId = randomUUID();
    try {
      await saveLocalRequest({ requestId, payload: parsed.data, pricing, files });
      const summary = formatQuoteEmail({ requestId, payload: parsed.data, pricing, catalog });
      const email = await sendQuoteNotification({ requestId, customerEmail: parsed.data.customer.email, summary, attachments });
      await updateLocalEmailStatus(requestId, email);
      if (email.status !== "provider_accepted") {
        return NextResponse.json({ error: "The request could not be safely accepted because the file email was not delivered. Your form entries are still available; try again or contact the shop.", requestId, detail: email.error }, { status: 502 });
      }
      await cleanupLocalArtwork(requestId);
      return NextResponse.json({ requestId, status: "received", pricingStatus: pricing.status, emailStatus: email.status, localDevelopment: true }, { status: 201 });
    } catch (error) {
      return NextResponse.json({ error: "Local request intake failed.", requestId, detail: error instanceof Error ? error.message : undefined }, { status: 500 });
    }
  }

  const requestId = randomUUID();
  try {
    await transaction(async (client) => {
      await client.query(
        `insert into quote_requests (id, idempotency_key, customer_name, customer_email, organization, phone,
           pricing_status, calculated_total, status)
         values ($1,$2,$3,$4,$5,$6,$7,$8,'received')`,
        [
          requestId,
          parsed.data.idempotencyKey,
          parsed.data.customer.name,
          parsed.data.customer.email,
          parsed.data.customer.organization || null,
          parsed.data.customer.phone || null,
          pricing.status,
          pricing.total,
        ],
      );

      for (let index = 0; index < parsed.data.jobs.length; index += 1) {
        const job = parsed.data.jobs[index];
        const product = catalog.products.find((item) => item.id === job.productId);
        await client.query(
          `insert into quote_jobs (quote_request_id, client_id, file_name, file_size, mime_type, page_count,
             product_id, size_id, material_id, product_name, size_name, material_name, finishing_names,
             custom_width, custom_height, custom_units, color_mode, orientation,
             quantity, sides, finishing_ids, notes, storage_path, pricing_status, calculated_subtotal, pricing_reason)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,null,$23,$24,$25)`,
          [
            requestId, job.clientId, job.fileName, job.fileSize, job.mimeType, job.pageCount,
            job.productId, job.sizeId, job.materialId,
            product?.name ?? null,
            product?.sizes.find((item) => item.id === job.sizeId)?.name ?? null,
            product?.sizes.find((item) => item.id === job.sizeId)?.papers.find((item) => item.materialId === job.materialId)?.name ?? null,
            JSON.stringify(job.finishingIds.map((id) => catalog.finishing.find((item) => item.id === id)?.name ?? id)),
            job.customWidth ?? null, job.customHeight ?? null, job.customUnits ?? null, job.colorMode, job.orientation,
            job.quantity, job.sides, JSON.stringify(job.finishingIds), job.notes ?? null,
            pricing.items[index].status, pricing.items[index].subtotal, pricing.items[index].reason,
          ],
        );
      }
    });
  } catch (error) {
    return NextResponse.json({ error: "The request could not be recorded. Please try again.", detail: error instanceof Error ? error.message : undefined }, { status: 500 });
  }

  const summary = formatQuoteEmail({ requestId, payload: parsed.data, pricing, catalog });
  const email = await sendQuoteNotification({ requestId, customerEmail: parsed.data.customer.email, summary, attachments });
  await queryOne(
    "insert into email_deliveries (quote_request_id, status, provider_message_id, error_message) values ($1,$2,$3,$4) returning id",
    [requestId, email.status, email.providerId ?? null, email.error ?? null],
  ).catch(() => null);

  if (email.status !== "provider_accepted") {
    await query("update quote_requests set status = 'intake_failed' where id = $1", [requestId]).catch(() => null);
    return NextResponse.json({ error: "The request could not be safely accepted because the file email was not delivered. Your form entries are still available; try again or contact the shop.", requestId }, { status: 502 });
  }
  return NextResponse.json({ requestId, status: "received", pricingStatus: pricing.status, emailStatus: email.status }, { status: 201 });
}
