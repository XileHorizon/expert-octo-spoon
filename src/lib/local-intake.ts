import { link, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { QuoteRequestInput } from "./validation";

const root = path.join(process.cwd(), ".local-data");

export async function claimLocalRequest(
  idempotencyKey: string,
  requestId: string,
  baseDirectory = root,
  beforePublish?: () => Promise<void>,
) {
  const directory = path.join(baseDirectory, "idempotency");
  const claimPath = path.join(directory, `${idempotencyKey}.json`);
  const temporaryPath = path.join(directory, `.${idempotencyKey}.${randomUUID()}.tmp`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await writeFile(temporaryPath, JSON.stringify({ requestId, status: "processing" }), { mode: 0o600, flag: "wx" });
    await beforePublish?.();
    // A same-directory hard link publishes the complete inode atomically and
    // fails with EEXIST rather than replacing another process's winning claim.
    await link(temporaryPath, claimPath);
    return { kind: "claimed" as const };
  } catch (error) {
    if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "EEXIST") throw error;
    const existing = JSON.parse(await readFile(claimPath, "utf8")) as { requestId: string; status: string };
    return { kind: "duplicate" as const, existing };
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function releaseLocalRequestClaim(idempotencyKey: string, requestId: string, baseDirectory = root) {
  const claimPath = path.join(baseDirectory, "idempotency", `${idempotencyKey}.json`);
  try {
    const existing = JSON.parse(await readFile(claimPath, "utf8")) as { requestId: string };
    if (existing.requestId === requestId) await rm(claimPath, { force: true });
  } catch {
    // A missing or unreadable failed claim needs no cleanup.
  }
}

function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-180) || "upload";
}

export async function findLocalRequestByIdempotencyKey(key: string) {
  try {
    const claim = JSON.parse(await readFile(path.join(root, "idempotency", `${key}.json`), "utf8")) as { requestId: string; status: string };
    try {
      const record = JSON.parse(await readFile(path.join(root, "requests", claim.requestId, "request.json"), "utf8")) as {
        emailDeliveries?: { type: string; status: string }[];
      };
      const shop = record.emailDeliveries?.find((item) => item.type === "shop_notification");
      return { ...claim, shopDeliveryStatus: shop?.status ?? null };
    } catch {
      return { ...claim, shopDeliveryStatus: null };
    }
  } catch {
    return null;
  }
}

export async function saveLocalRequest(input: {
  requestId: string;
  payload: QuoteRequestInput;
  pricing: ReturnType<typeof import("./pricing").priceQuote>;
  files: File[];
  shopRecipient: string | null;
  deliveryAuditIds: { shopNotification: string; customerConfirmation: string };
}) {
  const requestDir = path.join(root, "requests", input.requestId);
  const uploadDir = path.join(requestDir, "uploads");
  await mkdir(uploadDir, { recursive: true, mode: 0o700 });

  const uploads = [];
  for (let index = 0; index < input.files.length; index += 1) {
    const file = input.files[index];
    const storedName = `${String(index + 1).padStart(2, "0")}-${safeFileName(file.name)}`;
    const storedPath = path.join(uploadDir, storedName);
    await writeFile(storedPath, Buffer.from(await file.arrayBuffer()), { mode: 0o600 });
    uploads.push({ originalName: file.name, storedName, size: file.size, mimeType: file.type });
  }

  const record = {
    requestId: input.requestId,
    status: "request_received",
    createdAt: new Date().toISOString(),
    payload: input.payload,
    pricing: input.pricing,
    uploads,
    emailDeliveries: [
      { id: input.deliveryAuditIds.shopNotification, type: "shop_notification", recipient: input.shopRecipient, status: "queued" },
      { id: input.deliveryAuditIds.customerConfirmation, type: "customer_confirmation", recipient: input.payload.customer.email, status: "queued" },
    ],
  };
  await writeFile(path.join(requestDir, "request.json"), JSON.stringify(record, null, 2), { mode: 0o600 });
  await mkdir(path.join(root, "idempotency"), { recursive: true, mode: 0o700 });
  await writeFile(path.join(root, "idempotency", `${input.payload.idempotencyKey}.json`), JSON.stringify({ requestId: input.requestId, status: "request_received" }), { mode: 0o600 });
  return { requestDir, record };
}

export async function updateLocalEmailStatus(requestId: string, auditId: string, email: unknown) {
  const recordPath = path.join(root, "requests", requestId, "request.json");
  const record = JSON.parse(await readFile(recordPath, "utf8"));
  const index = record.emailDeliveries?.findIndex((item: { id: string }) => item.id === auditId) ?? -1;
  if (index < 0) throw new Error("The prepared local delivery audit record is missing.");
  record.emailDeliveries[index] = { ...record.emailDeliveries[index], ...email as object };
  await writeFile(recordPath, JSON.stringify(record, null, 2), { mode: 0o600 });
}

export async function updateLocalRequestStatus(requestId: string, status: string) {
  const recordPath = path.join(root, "requests", requestId, "request.json");
  const record = JSON.parse(await readFile(recordPath, "utf8"));
  record.status = status;
  await writeFile(recordPath, JSON.stringify(record, null, 2), { mode: 0o600 });
  await writeFile(path.join(root, "idempotency", `${record.payload.idempotencyKey}.json`), JSON.stringify({ requestId, status }), { mode: 0o600 });
}

/** Local-development parity with production: remove artwork after SMTP accepts the handoff. */
export async function cleanupLocalArtwork(requestId: string) {
  await rm(path.join(root, "requests", requestId, "uploads"), { recursive: true, force: true });
}
