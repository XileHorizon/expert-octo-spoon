import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { QuoteRequestInput } from "./validation";

const root = path.join(process.cwd(), ".local-data");

function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-180) || "upload";
}

export async function findLocalRequestByIdempotencyKey(key: string) {
  try {
    return JSON.parse(await readFile(path.join(root, "idempotency", `${key}.json`), "utf8")) as { requestId: string; status: string };
  } catch {
    return null;
  }
}

export async function saveLocalRequest(input: {
  requestId: string;
  payload: QuoteRequestInput;
  pricing: ReturnType<typeof import("./pricing").priceQuote>;
  files: File[];
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
    status: "received",
    createdAt: new Date().toISOString(),
    payload: input.payload,
    pricing: input.pricing,
    uploads,
    email: { status: "pending" },
  };
  await writeFile(path.join(requestDir, "request.json"), JSON.stringify(record, null, 2), { mode: 0o600 });
  await mkdir(path.join(root, "idempotency"), { recursive: true, mode: 0o700 });
  await writeFile(path.join(root, "idempotency", `${input.payload.idempotencyKey}.json`), JSON.stringify({ requestId: input.requestId, status: "received" }), { mode: 0o600 });
  return { requestDir, record };
}

export async function updateLocalEmailStatus(requestId: string, email: unknown) {
  const recordPath = path.join(root, "requests", requestId, "request.json");
  const record = JSON.parse(await readFile(recordPath, "utf8"));
  record.email = email;
  await writeFile(recordPath, JSON.stringify(record, null, 2), { mode: 0o600 });
}

/** Local-development parity with production: remove artwork after SMTP accepts the handoff. */
export async function cleanupLocalArtwork(requestId: string) {
  await rm(path.join(root, "requests", requestId, "uploads"), { recursive: true, force: true });
}
