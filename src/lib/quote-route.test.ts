import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Catalog } from "./types";
import { MAX_FILE_BYTES } from "./validation";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  transaction: vi.fn(),
  send: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: () => true,
  query: mocks.query,
  queryOne: mocks.queryOne,
  transaction: mocks.transaction,
}));

vi.mock("@/lib/email", () => ({
  sendQuoteNotification: mocks.send,
  sendCustomerConfirmation: mocks.confirm,
}));

const size = {
  id: "size", name: "Letter", dimensions: "8.5 x 11", active: true, basePrice: "0.10",
  billingUnit: "printed_page" as const, minimumQuantity: 1, manualQuote: false, includedNote: null,
  papers: [{ materialId: "paper", name: "Paper", weight: null, category: null, surcharge: "0", isStandard: true, active: true }],
};
const catalog: Catalog = {
  fixtureMode: false, placeholderNotice: null, minimumOrderTotal: "0.00", papers: [],
  modeAdjustments: { color: "0", blackWhite: "0", portrait: "0", landscape: "0" },
  products: [{ id: "product", name: "Print", description: "", active: true, minimumQuantity: 1, sizes: [size] }],
  finishing: [], bulkTiers: [],
};
vi.mock("@/lib/catalog-server", () => ({ getServerCatalog: vi.fn(async () => catalog) }));

import { POST } from "@/app/api/quote-requests/route";

const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
const validPayload = {
  idempotencyKey: "123e4567-e89b-42d3-a456-426614174000",
  customer: { name: "Customer", email: "customer@example.test" },
  jobs: [{
    clientId: "job", fileName: "art.pdf", fileSize: pdfBytes.length, mimeType: "application/pdf", pageCount: 1,
    productId: "product", sizeId: "size", materialId: "paper", quantity: 1, sides: 1 as const,
    colorMode: "color" as const, orientation: "portrait" as const, finishingIds: [],
  }],
};

function multipart(payload: unknown = validPayload, files: File[] = [new File([pdfBytes], "art.pdf", { type: "application/pdf" })]) {
  const form = new FormData();
  form.set("payload", typeof payload === "string" ? payload : JSON.stringify(payload));
  for (const file of files) form.append("files", file, file.name);
  return new Request("http://example.test/api/quote-requests", { method: "POST", body: form });
}

async function body(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

describe("POST /api/quote-requests hostile-input boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queryOne.mockResolvedValue(null);
    mocks.query.mockResolvedValue({ rows: [], rowCount: 1, affectedRows: 1, insertId: 0 });
    mocks.transaction.mockImplementation(async (callback: (client: { query: typeof mocks.query }) => unknown) => callback({ query: mocks.query }));
    mocks.send.mockResolvedValue({ status: "provider_accepted", providerId: "mail-1" });
    mocks.confirm.mockResolvedValue({ status: "provider_accepted", providerId: "mail-2" });
  });

  it("rejects a non-multipart body without touching persistence or delivery", async () => {
    const response = await POST(new Request("http://example.test/api/quote-requests", { method: "POST", body: "not multipart" }));
    expect(response.status).toBe(400);
    expect(await body(response)).toMatchObject({ error: "Invalid form data." });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it.each([
    ["missing payload", (() => { const form = new FormData(); return new Request("http://example.test/api/quote-requests", { method: "POST", body: form }); })(), 400],
    ["malformed JSON", multipart("{not-json"), 400],
    ["object instead of jobs array", multipart({ ...validPayload, jobs: { 0: validPayload.jobs[0] } }), 422],
    ["oversized declared file", multipart({ ...validPayload, jobs: [{ ...validPayload.jobs[0], fileSize: MAX_FILE_BYTES + 1 }] }), 413],
    ["more than ten jobs", multipart({ ...validPayload, jobs: Array.from({ length: 11 }, (_, index) => ({ ...validPayload.jobs[0], clientId: `job-${index}` })) }), 413],
  ])("rejects %s before persistence or delivery", async (_label, request, status) => {
    const response = await POST(request);
    expect(response.status).toBe(status);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("rejects SQL-like catalog identifiers as data, before persistence", async () => {
    const response = await POST(multipart({
      ...validPayload,
      jobs: [{ ...validPayload.jobs[0], productId: "product' OR 1=1 --" }],
    }));
    expect(response.status).toBe(422);
    expect(await body(response)).toMatchObject({ error: expect.stringContaining("catalog selection") });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it.each([
    ["forged PDF signature", validPayload, new File([new Uint8Array([0, 1, 2, 3])], "art.pdf", { type: "application/pdf" })],
    ["name mismatch", validPayload, new File([pdfBytes], "renamed.pdf", { type: "application/pdf" })],
    ["MIME mismatch", validPayload, new File([pdfBytes], "art.pdf", { type: "image/png" })],
  ])("rejects %s before submission orchestration", async (_label, payload, file) => {
    const adjusted = { ...payload, jobs: [{ ...payload.jobs[0], fileSize: file.size }] };
    const response = await POST(multipart(adjusted, [file]));
    expect(response.status).toBe(422);
    expect(await body(response)).toMatchObject({ error: expect.stringMatching(/contact the print shop directly.*614.*support@shipprintesell\.com/i) });
    expect(mocks.queryOne).toHaveBeenCalledWith("select contact_phone,contact_email from business_settings where id=1");
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("accepts exactly ten valid files/jobs at the count boundary", async () => {
    const files = Array.from({ length: 10 }, (_, index) => new File([pdfBytes], `art-${index}.pdf`, { type: "application/pdf" }));
    const payload = {
      ...validPayload,
      jobs: files.map((file, index) => ({ ...validPayload.jobs[0], clientId: `job-${index}`, fileName: file.name, fileSize: file.size })),
    };
    const response = await POST(multipart(payload, files));
    expect(response.status).toBe(201);
    expect(await body(response)).toMatchObject({ status: "request_received", pricingStatus: "priced", emailStatus: "provider_accepted", customerConfirmationStatus: "provider_accepted" });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.send).toHaveBeenCalledOnce();
  });

  it("replays a persisted failed shop outcome on a same-key retry without sending again", async () => {
    mocks.queryOne.mockResolvedValueOnce({ id: "request-existing", status: "request_received", shopDeliveryStatus: "failed" });

    const response = await POST(multipart());

    expect(response.status).toBe(502);
    expect(await body(response)).toMatchObject({ requestId: "request-existing", duplicate: true, emailStatus: "failed" });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("surfaces a persisted queued audit as reconciliation-required without resending", async () => {
    mocks.queryOne.mockResolvedValueOnce({ id: "request-existing", status: "request_received", shopDeliveryStatus: "queued" });

    const response = await POST(multipart());

    expect(response.status).toBe(202);
    expect(await body(response)).toMatchObject({ requestId: "request-existing", duplicate: true, reconciliationRequired: true });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
