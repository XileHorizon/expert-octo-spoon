import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getServerCatalog } from "@/lib/catalog-server";
import { isDatabaseConfigured, query, queryOne, transaction } from "@/lib/db";
import { sendCustomerConfirmation, sendQuoteNotification } from "@/lib/email";
import { claimLocalRequest, cleanupLocalArtwork, findLocalRequestByIdempotencyKey, releaseLocalRequestClaim, saveLocalRequest, updateLocalEmailStatus } from "@/lib/local-intake";
import { submitQuote, type ExistingQuote, type QuoteSnapshot, type QuoteSubmissionDependencies } from "@/lib/quote-submission";
import { ALLOWED_MIME_TYPES, MAX_FILE_BYTES, MAX_FILES, quoteRequestSchema, uploadLimitProblem, uploadLimitProblemWithContact } from "@/lib/validation";
import { defaultBusinessSettings } from "@/lib/admin-validation";
import type { EmailBusinessSettings } from "@/lib/quote-email";

export const runtime = "nodejs";

async function configuredContact(databaseReady: boolean) {
  if (!databaseReady) return { contact_phone: defaultBusinessSettings.contact_phone, contact_email: defaultBusinessSettings.contact_email };
  const row = await queryOne<{ contact_phone: string; contact_email: string }>("select contact_phone,contact_email from business_settings where id=1").catch(() => null);
  return row ?? { contact_phone: defaultBusinessSettings.contact_phone, contact_email: defaultBusinessSettings.contact_email };
}

async function signatureMatches(file: File) {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (file.type === "application/pdf") return String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-";
  if (file.type === "image/png") return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (file.type === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return false;
}

function isDuplicateEntry(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ER_DUP_ENTRY";
}

async function persistDatabaseQuote(snapshot: QuoteSnapshot): Promise<{ kind: "created"; audits: { shopNotification: string; customerConfirmation: string } } | { kind: "duplicate"; quote: ExistingQuote }> {
  const { requestId, payload, pricing, catalog } = snapshot;
  const audits = { shopNotification: randomUUID(), customerConfirmation: randomUUID() };
  try {
    await transaction(async (client) => {
      await client.query(
        `insert into quote_requests (id, idempotency_key, customer_name, customer_email, organization, phone,
           pricing_status, calculated_total, calculated_subtotal, minimum_order_adjustment, status)
         values (?,?,?,?,?,?,?,?,?,?,'request_received')`,
        [
          requestId,
          payload.idempotencyKey,
          payload.customer.name,
          payload.customer.email,
          payload.customer.organization || null,
          payload.customer.phone || null,
          pricing.status,
          pricing.total,
          pricing.subtotal,
          pricing.minimumOrderAdjustment,
        ],
      );

      for (let index = 0; index < payload.jobs.length; index += 1) {
        const job = payload.jobs[index];
        const product = catalog.products.find((item) => item.id === job.productId);
        await client.query(
          `insert into quote_jobs (quote_request_id, client_id, file_name, file_size, mime_type, page_count,
             product_id, size_id, material_id, product_name, size_name, material_name, finishing_names,
             custom_width, custom_height, custom_units, color_mode, orientation,
             quantity, sides, finishing_ids, notes, storage_path, pricing_status, calculated_subtotal,
             color_adjustment, orientation_adjustment, pricing_reason)
           values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,null,?,?,?,?,?)`,
          [
            requestId, job.clientId, job.fileName, job.fileSize, job.mimeType, job.pageCount,
            job.productId, job.sizeId, job.materialId,
            product?.name ?? null,
            product?.sizes.find((item) => item.id === job.sizeId)?.name ?? null,
            product?.sizes.find((item) => item.id === job.sizeId)?.papers.find((item) => item.materialId === job.materialId)?.name ?? null,
            JSON.stringify(job.finishingIds.map((id) => catalog.finishing.find((item) => item.id === id)?.name ?? id)),
            job.customWidth ?? null, job.customHeight ?? null, job.customUnits ?? null, job.colorMode, job.orientation,
            job.quantity, job.sides, JSON.stringify(job.finishingIds), job.notes ?? null,
            pricing.items[index].status, pricing.items[index].subtotal,
            pricing.items[index].lines.find((line) => /^(Full color|Black & white) adjustment$/.test(line.label))?.amount ?? "0.00",
            pricing.items[index].lines.find((line) => /^(Portrait|Landscape) adjustment$/.test(line.label))?.amount ?? "0.00",
            pricing.items[index].reason,
          ],
        );
      }

      await client.query(
        `insert into email_deliveries (id, quote_request_id, delivery_type, recipient, status)
         values (?,?,'shop_notification',?,'queued'),(?,?,'customer_confirmation',?,'queued')`,
        [audits.shopNotification, requestId, snapshot.shopRecipient, audits.customerConfirmation, requestId, payload.customer.email],
      );
    });
    return { kind: "created", audits };
  } catch (error) {
    if (isDuplicateEntry(error)) {
      const existing = await findDatabaseRequest(payload.idempotencyKey);
      if (existing) return { kind: "duplicate", quote: existing };
    }
    throw error;
  }
}

async function findDatabaseRequest(idempotencyKey: string) {
  return queryOne<ExistingQuote>(
    `select q.id,q.status,e.status as shopDeliveryStatus
       from quote_requests q
       left join email_deliveries e on e.quote_request_id=q.id and e.delivery_type='shop_notification'
      where q.idempotency_key=?
      order by e.attempt_sequence desc limit 1`,
    [idempotencyKey],
  );
}

function databaseDependencies(): QuoteSubmissionDependencies {
  return {
    createRequestId: randomUUID,
    loadCatalog: getServerCatalog,
    findExisting: findDatabaseRequest,
    persist: persistDatabaseQuote,
    resolveNotificationRecipient: async () => {
      const settings = await queryOne<{ notification_target: string | null }>("select notification_target from business_settings where id = 1").catch(() => null);
      return settings?.notification_target || process.env.QUOTE_NOTIFICATION_TO;
    },
    loadBusinessSettings: async () => {
      const row = await queryOne<{ contact_phone: string; contact_email: string; turnaround_intro: string; standard_turnaround: string; rush_turnaround: string }>(
        "select contact_phone,contact_email,turnaround_intro,standard_turnaround,rush_turnaround from business_settings where id=1",
      );
      return businessEmailSettings(row);
    },
    deliver: sendQuoteNotification,
    deliverCustomerConfirmation: sendCustomerConfirmation,
    recordDelivery: async (_requestId, auditId, email) => {
      const result = await query(
        "update email_deliveries set status=?,provider_message_id=?,error_message=? where id=?",
        [email.status, email.providerId ?? null, email.error ?? null, auditId],
      );
      if (result.affectedRows !== 1) {
        const existing = await queryOne("select id from email_deliveries where id=?", [auditId]);
        if (!existing) throw new Error("The prepared delivery audit record is missing.");
      }
    },
    cleanupAcceptedArtwork: async () => undefined,
  };
}

function localDependencies(): QuoteSubmissionDependencies {
  return {
    createRequestId: randomUUID,
    loadCatalog: getServerCatalog,
    findExisting: async (key) => {
      const existing = await findLocalRequestByIdempotencyKey(key);
      return existing ? { id: existing.requestId, status: existing.status, shopDeliveryStatus: existing.shopDeliveryStatus as ExistingQuote["shopDeliveryStatus"] } : null;
    },
    persist: async (snapshot) => {
      const claim = await claimLocalRequest(snapshot.payload.idempotencyKey, snapshot.requestId);
      if (claim.kind === "duplicate") return { kind: "duplicate", quote: { id: claim.existing.requestId, status: claim.existing.status, shopDeliveryStatus: null } };
      const audits = { shopNotification: randomUUID(), customerConfirmation: randomUUID() };
      try {
        await saveLocalRequest({
          requestId: snapshot.requestId,
          payload: snapshot.payload,
          pricing: snapshot.pricing,
          files: snapshot.files,
          shopRecipient: snapshot.shopRecipient,
          deliveryAuditIds: audits,
        });
        return { kind: "created", audits };
      } catch (error) {
        await releaseLocalRequestClaim(snapshot.payload.idempotencyKey, snapshot.requestId);
        throw error;
      }
    },
    resolveNotificationRecipient: async () => process.env.QUOTE_NOTIFICATION_TO,
    loadBusinessSettings: async () => businessEmailSettings(null),
    deliver: sendQuoteNotification,
    deliverCustomerConfirmation: sendCustomerConfirmation,
    recordDelivery: updateLocalEmailStatus,
    cleanupAcceptedArtwork: cleanupLocalArtwork,
  };
}

function businessEmailSettings(row: { contact_phone: string; contact_email: string; turnaround_intro: string; standard_turnaround: string; rush_turnaround: string } | null): EmailBusinessSettings {
  return {
    contactPhone: row?.contact_phone ?? defaultBusinessSettings.contact_phone,
    contactEmail: row?.contact_email ?? defaultBusinessSettings.contact_email,
    turnaroundIntro: row?.turnaround_intro ?? defaultBusinessSettings.turnaround_intro,
    standardTurnaround: row?.standard_turnaround ?? defaultBusinessSettings.standard_turnaround,
    rushTurnaround: row?.rush_turnaround ?? defaultBusinessSettings.rush_turnaround,
  };
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
  if (typeof parsedJson === "object" && parsedJson !== null && "jobs" in parsedJson && Array.isArray(parsedJson.jobs)) {
    const declared = parsedJson.jobs as { fileSize?: unknown }[];
    const sizes = declared.map((job) => typeof job?.fileSize === "number" ? job.fileSize : 0);
    let preliminary: string | null = null;
    if (declared.length > MAX_FILES) preliminary = `A request can include at most ${MAX_FILES} files.`;
    else if (sizes.some((size) => size > MAX_FILE_BYTES)) preliminary = `Each file must be 25 MB or smaller.`;
    else preliminary = uploadLimitProblem(sizes.reduce((sum, size) => sum + size, 0), declared.length);
    if (preliminary) return NextResponse.json({ error: uploadLimitProblemWithContact(preliminary, await configuredContact(databaseReady)) }, { status: 413 });
  }
  const parsed = quoteRequestSchema.safeParse(parsedJson);
  if (!parsed.success) return NextResponse.json({ error: "Please correct the highlighted request details.", issues: parsed.error.flatten() }, { status: 422 });

  const files = form.getAll("files").filter((item): item is File => item instanceof File);
  if (files.length !== parsed.data.jobs.length) return NextResponse.json({ error: "Every job must include one original file." }, { status: 422 });
  const limitProblem = uploadLimitProblem(files.reduce((sum, file) => sum + file.size, 0), files.length);
  if (limitProblem) {
    const contact = await configuredContact(databaseReady);
    return NextResponse.json({ error: uploadLimitProblemWithContact(limitProblem, contact) }, { status: 413 });
  }
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]; const job = parsed.data.jobs[index];
    if (file.name !== job.fileName || file.size !== job.fileSize || file.type !== job.mimeType || file.size > MAX_FILE_BYTES || !ALLOWED_MIME_TYPES.has(file.type) || !(await signatureMatches(file))) {
      const problem = `File ${index + 1} must be an unchanged PDF, PNG, or JPEG no larger than 25 MB.`;
      return NextResponse.json({ error: uploadLimitProblemWithContact(problem, await configuredContact(databaseReady)) }, { status: 422 });
    }
  }

  const attachments = await Promise.all(files.map(async (file) => ({ filename: file.name, contentType: file.type, content: Buffer.from(await file.arrayBuffer()) })));
  try {
    const result = await submitQuote({ payload: parsed.data, files, attachments }, databaseReady ? databaseDependencies() : localDependencies());
    if (result.kind === "duplicate") {
      if (result.shopDeliveryStatus === "failed" || result.shopDeliveryStatus === "not_configured") {
        return NextResponse.json({
          error: "This request was recorded previously, but its file email was not accepted. Contact the shop with the request reference before resubmitting.",
          requestId: result.requestId,
          duplicate: true,
          emailStatus: result.shopDeliveryStatus,
        }, { status: 502 });
      }
      return NextResponse.json({
        requestId: result.requestId,
        status: result.status,
        duplicate: true,
        ...(result.shopDeliveryStatus === "queued" || result.shopDeliveryStatus == null ? { reconciliationRequired: true } : {}),
      }, { status: result.shopDeliveryStatus === "queued" || result.shopDeliveryStatus == null ? 202 : 200 });
    }
    if (result.kind === "invalid") return NextResponse.json({ error: result.error }, { status: 422 });
    if (result.kind === "delivery_failed") {
      return NextResponse.json({
        error: "The request was recorded, but its file email was not accepted. Contact the shop with the request reference before resubmitting.",
        requestId: result.requestId,
        ...(databaseReady ? {} : { detail: result.email.error }),
      }, { status: 502 });
    }
    if (result.kind === "audit_reconciliation_required") {
      const providerAccepted = result.email.status === "provider_accepted";
      return NextResponse.json({
        ...(providerAccepted
          ? { message: "The request was received, but the owner must reconcile its email delivery record." }
          : { error: "The request was recorded, but its email handoff needs owner review. Contact the shop with the request reference before resubmitting." }),
        requestId: result.requestId,
        status: "request_received",
        reconciliationRequired: true,
        deliveryType: result.deliveryType,
        emailStatus: result.email.status,
      }, { status: providerAccepted ? 202 : 502 });
    }
    return NextResponse.json({
      requestId: result.requestId,
      status: "request_received",
      pricingStatus: result.pricing.status,
      emailStatus: result.email.status,
      customerConfirmationStatus: result.customerConfirmation.status,
      ...(databaseReady ? {} : { localDevelopment: true }),
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json({
      error: databaseReady ? "The request could not be recorded. Please try again." : "Local request intake failed.",
      detail: error instanceof Error ? error.message : undefined,
    }, { status: 500 });
  }
}
