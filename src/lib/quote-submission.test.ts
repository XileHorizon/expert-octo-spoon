import { beforeEach, describe, expect, it, vi } from "vitest";
import { submitQuote, type QuoteSnapshot, type QuoteSubmissionDependencies } from "./quote-submission";
import type { Catalog } from "./types";
import type { QuoteRequestInput } from "./validation";

const size = {
  id: "letter", name: "Letter", dimensions: "8.5 × 11", active: true, basePrice: "0.20",
  billingUnit: "printed_page" as const, minimumQuantity: 1, manualQuote: false, includedNote: null,
  papers: [{ materialId: "standard", name: "Standard", weight: "20 lb", category: "Uncoated", surcharge: "0", isStandard: true, active: true }],
};

const catalog: Catalog = {
  fixtureMode: false,
  modeAdjustments: { color: "0", blackWhite: "0", portrait: "0", landscape: "0" },
  placeholderNotice: null,
  minimumOrderTotal: "25.00",
  papers: [],
  products: [{ id: "print", name: "Print", description: "", active: true, minimumQuantity: 1, sizes: [size] }],
  finishing: [],
  bulkTiers: [],
};

const payload: QuoteRequestInput = {
  idempotencyKey: "123e4567-e89b-42d3-a456-426614174000",
  customer: { name: "Customer", email: "customer@example.com", organization: "", phone: "" },
  jobs: [{
    clientId: "job-1", fileName: "art.pdf", fileSize: 12, mimeType: "application/pdf", pageCount: 1,
    productId: "print", sizeId: "letter", materialId: "standard", quantity: 10, sides: 1,
    colorMode: "color", orientation: "portrait", finishingIds: [], notes: "",
  }],
};

function dependencies(overrides: Partial<QuoteSubmissionDependencies> = {}) {
  const state = { snapshots: [] as QuoteSnapshot[], deliveries: [] as string[], failed: [] as string[], cleaned: [] as string[] };
  const value: QuoteSubmissionDependencies = {
    createRequestId: () => "quote-123",
    loadCatalog: vi.fn(async () => catalog),
    findExisting: vi.fn(async () => null),
    persist: vi.fn(async (snapshot) => {
      state.snapshots.push(snapshot);
      return { kind: "created" as const, audits: { shopNotification: "audit-shop", customerConfirmation: "audit-customer" } };
    }),
    resolveNotificationRecipient: vi.fn(async () => "orders@example.com"),
    loadBusinessSettings: vi.fn(async () => ({ contactPhone: "555-0100", contactEmail: "shop@example.com", turnaroundIntro: "We review every request.", standardTurnaround: "3-5 days", rushTurnaround: "1-2 days" })),
    deliver: vi.fn(async () => ({ status: "provider_accepted" as const, providerId: "message-1" })),
    deliverCustomerConfirmation: vi.fn(async () => ({ status: "provider_accepted" as const, providerId: "message-2" })),
    recordDelivery: vi.fn(async (requestId) => { state.deliveries.push(requestId); }),
    cleanupAcceptedArtwork: vi.fn(async (requestId) => { state.cleaned.push(requestId); }),
    ...overrides,
  };
  return { value, state };
}

const submission = { payload, files: [] as File[], attachments: [{ filename: "art.pdf", contentType: "application/pdf", content: Buffer.from("%PDF-test") }] };

describe("submitQuote", () => {
  beforeEach(() => vi.clearAllMocks());

  it("persists the priced snapshot and delivers the expected recipient, content, and attachment", async () => {
    const deps = dependencies();
    const result = await submitQuote(submission, deps.value);

    expect(result).toMatchObject({ kind: "accepted", requestId: "quote-123", pricing: { subtotal: "2.00", minimumOrderAdjustment: "23.00", total: "25.00" } });
    expect(deps.state.snapshots[0].pricing).toMatchObject({ status: "priced", subtotal: "2.00", minimumOrderAdjustment: "23.00", total: "25.00" });
    expect(deps.value.deliver).toHaveBeenCalledOnce();
    expect(deps.value.deliver).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "quote-123",
      customerEmail: "customer@example.com",
      recipient: "orders@example.com",
      attachments: submission.attachments,
      summary: expect.stringContaining("Minimum order adjustment: $23.00"),
      html: expect.stringContaining("Minimum order adjustment:"),
    }));
    expect(deps.state.deliveries).toEqual(["quote-123", "quote-123"]);
    expect(deps.state.failed).toEqual([]);
    expect(deps.state.cleaned).toEqual(["quote-123"]);
  });

  it("records provider failure, preserves the snapshot, and marks intake failed", async () => {
    const deps = dependencies({ deliver: vi.fn(async () => ({ status: "failed" as const, error: "provider unavailable" })) });
    const result = await submitQuote(submission, deps.value);

    expect(result).toMatchObject({ kind: "delivery_failed", requestId: "quote-123", email: { status: "failed" } });
    expect(deps.state.snapshots).toHaveLength(1);
    expect(deps.state.deliveries).toEqual(["quote-123"]);
    expect(deps.state.failed).toEqual([]);
    expect(deps.state.cleaned).toEqual([]);
  });

  it("accepts the quote and records a failed customer confirmation after shop acceptance", async () => {
    const deps = dependencies({ deliverCustomerConfirmation: vi.fn(async () => ({ status: "failed" as const, error: "customer mailbox rejected" })) });
    const result = await submitQuote(submission, deps.value);

    expect(result).toMatchObject({ kind: "accepted", customerConfirmation: { status: "failed" } });
    expect(deps.value.deliver).toHaveBeenCalledOnce();
    expect(deps.value.deliverCustomerConfirmation).toHaveBeenCalledOnce();
    expect(deps.state.deliveries).toEqual(["quote-123", "quote-123"]);
    expect(deps.state.cleaned).toEqual(["quote-123"]);
  });

  it("returns an existing idempotent request without creating or sending another quote", async () => {
    const deps = dependencies({ findExisting: vi.fn(async () => ({ id: "quote-existing", status: "request_received" })) });
    const result = await submitQuote(submission, deps.value);

    expect(result).toEqual({ kind: "duplicate", requestId: "quote-existing", status: "request_received" });
    expect(deps.value.loadCatalog).not.toHaveBeenCalled();
    expect(deps.value.persist).not.toHaveBeenCalled();
    expect(deps.value.deliver).not.toHaveBeenCalled();
  });

  it("handles a concurrent idempotency conflict without sending", async () => {
    const deps = dependencies({ persist: vi.fn(async () => ({ kind: "duplicate" as const, quote: { id: "quote-winner", status: "request_received" } })) });
    const result = await submitQuote(submission, deps.value);

    expect(result).toEqual({ kind: "duplicate", requestId: "quote-winner", status: "request_received" });
    expect(deps.value.deliver).not.toHaveBeenCalled();
  });

  it("does not persist or send a below-minimum submission", async () => {
    const minimumCatalog: Catalog = {
      ...catalog,
      products: [{ ...catalog.products[0], minimumQuantity: 5 }],
    };
    const deps = dependencies({ loadCatalog: vi.fn(async () => minimumCatalog) });
    const result = await submitQuote({ ...submission, payload: { ...payload, jobs: [{ ...payload.jobs[0], quantity: 1 }] } }, deps.value);

    expect(result).toMatchObject({ kind: "invalid", error: expect.stringContaining("minimum quantity") });
    expect(deps.value.persist).not.toHaveBeenCalled();
    expect(deps.value.deliver).not.toHaveBeenCalled();
  });

  it("does not persist or send an invalid catalog submission", async () => {
    const deps = dependencies();
    const result = await submitQuote({ ...submission, payload: { ...payload, jobs: [{ ...payload.jobs[0], materialId: "missing" }] } }, deps.value);

    expect(result).toMatchObject({ kind: "invalid" });
    expect(deps.value.persist).not.toHaveBeenCalled();
    expect(deps.value.deliver).not.toHaveBeenCalled();
  });

  it("accepts manual quotes without applying the minimum order adjustment", async () => {
    const manualCatalog: Catalog = {
      ...catalog,
      products: [{ ...catalog.products[0], sizes: [{ ...size, manualQuote: true, basePrice: null }] }],
    };
    const deps = dependencies({ loadCatalog: vi.fn(async () => manualCatalog) });
    const result = await submitQuote(submission, deps.value);

    expect(result).toMatchObject({ kind: "accepted", pricing: { status: "manual", total: null, minimumOrderAdjustment: null } });
    expect(deps.state.snapshots[0].pricing).toMatchObject({ status: "manual", subtotal: null, minimumOrderAdjustment: null });
    expect(deps.value.deliver).toHaveBeenCalledWith(expect.objectContaining({ summary: expect.stringContaining("Manual quote required") }));
  });
});
