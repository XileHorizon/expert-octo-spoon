import { describe, expect, it, vi } from "vitest";
import { submitQuote, type ExistingQuote, type QuoteSnapshot, type QuoteSubmissionDependencies } from "./quote-submission";
import type { Catalog } from "./types";
import type { QuoteRequestInput } from "./validation";

const catalog: Catalog = {
  fixtureMode: false, placeholderNotice: null, minimumOrderTotal: "5.00", papers: [], finishing: [], bulkTiers: [],
  modeAdjustments: { color: "0", blackWhite: "0", portrait: "0", landscape: "0" },
  products: [{
    id: "product", name: "Print", description: "", active: true, minimumQuantity: 1,
    sizes: [{
      id: "size", name: "Letter", dimensions: "8.5 x 11", active: true, basePrice: "0.10",
      billingUnit: "printed_page", minimumQuantity: 1, manualQuote: false, includedNote: null,
      papers: [{ materialId: "paper", name: "Paper", weight: null, category: null, surcharge: "0", isStandard: true, active: true }],
    }],
  }],
};
const payload: QuoteRequestInput = {
  idempotencyKey: "123e4567-e89b-42d3-a456-426614174000",
  customer: { name: "Customer", email: "customer@example.test" },
  jobs: [{
    clientId: "job", fileName: "art.pdf", fileSize: 8, mimeType: "application/pdf", pageCount: 1,
    productId: "product", sizeId: "size", materialId: "paper", quantity: 1, sides: 1,
    colorMode: "color", orientation: "portrait", finishingIds: [],
  }],
};
const input = {
  payload,
  files: [] as File[],
  attachments: [{ filename: "art.pdf", contentType: "application/pdf", content: Buffer.from("%PDF-1.4") }],
};

function statefulDependencies(emailStatus: "not_configured" | "queued" | "failed") {
  let stored: ExistingQuote | null = null;
  const snapshots: QuoteSnapshot[] = [];
  const dependencies: QuoteSubmissionDependencies = {
    createRequestId: () => "request-1",
    loadCatalog: vi.fn(async () => catalog),
    findExisting: vi.fn(async () => stored),
    persist: vi.fn(async (snapshot) => {
      snapshots.push(snapshot);
      stored = { id: snapshot.requestId, status: "request_received", shopDeliveryStatus: "queued" };
      return { kind: "created" as const, audits: { shopNotification: "audit-shop", customerConfirmation: "audit-customer" } };
    }),
    resolveNotificationRecipient: vi.fn(async () => "orders@example.test"),
    loadBusinessSettings: vi.fn(async () => ({ contactPhone: "", contactEmail: "shop@example.test", turnaroundIntro: "Review", standardTurnaround: "", rushTurnaround: "" })),
    deliver: vi.fn(async () => ({ status: emailStatus, ...(emailStatus === "failed" ? { error: "provider rejected" } : {}) })),
    deliverCustomerConfirmation: vi.fn(async () => ({ status: "provider_accepted" as const })),
    recordDelivery: vi.fn(async (_requestId, auditId, result) => {
      if (auditId === "audit-shop" && stored) stored.shopDeliveryStatus = result.status;
    }),
    cleanupAcceptedArtwork: vi.fn(async () => undefined),
  };
  return { dependencies, snapshots };
}

describe("quote submission failure and retry semantics", () => {
  it.each(["not_configured", "queued", "failed"] as const)("treats %s as a failed handoff and keeps the persisted quote reviewable", async (emailStatus) => {
    const { dependencies, snapshots } = statefulDependencies(emailStatus);
    const result = await submitQuote(input, dependencies);

    expect(result).toMatchObject({ kind: "delivery_failed", requestId: "request-1", email: { status: emailStatus } });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].pricing).toMatchObject({ subtotal: "0.10", minimumOrderAdjustment: "4.90", total: "5.00" });
    expect(dependencies.recordDelivery).toHaveBeenCalledOnce();
    expect(dependencies.cleanupAcceptedArtwork).not.toHaveBeenCalled();
  });

  it("suppresses delivery when a client retries after a failed handoff", async () => {
    const { dependencies, snapshots } = statefulDependencies("failed");
    const first = await submitQuote(input, dependencies);
    const second = await submitQuote(input, dependencies);

    expect(first.kind).toBe("delivery_failed");
    expect(second).toEqual({ kind: "duplicate", requestId: "request-1", status: "request_received", shopDeliveryStatus: "failed" });
    expect(snapshots).toHaveLength(1);
    expect(dependencies.persist).toHaveBeenCalledOnce();
    expect(dependencies.deliver).toHaveBeenCalledOnce();
  });

  it("does not resend when the persistence layer wins a concurrent idempotency race", async () => {
    const dependencies = statefulDependencies("failed").dependencies;
    dependencies.persist = vi.fn(async () => ({ kind: "duplicate" as const, quote: { id: "winner", status: "request_received" } }));

    await expect(submitQuote(input, dependencies)).resolves.toEqual({ kind: "duplicate", requestId: "winner", status: "request_received" });
    expect(dependencies.resolveNotificationRecipient).toHaveBeenCalledOnce();
    expect(dependencies.deliver).not.toHaveBeenCalled();
    expect(dependencies.recordDelivery).not.toHaveBeenCalled();
  });

  it("surfaces a shop audit reconciliation failure and never resends an accepted handoff on retry", async () => {
    const { dependencies } = statefulDependencies("failed");
    dependencies.deliver = vi.fn(async () => ({ status: "provider_accepted" as const, providerId: "accepted-shop" }));
    dependencies.recordDelivery = vi.fn(async () => { throw new Error("audit update unavailable"); });

    const first = await submitQuote(input, dependencies);
    const second = await submitQuote(input, dependencies);

    expect(first).toMatchObject({ kind: "audit_reconciliation_required", requestId: "request-1", deliveryType: "shop_notification", email: { status: "provider_accepted" } });
    expect(second).toEqual({ kind: "duplicate", requestId: "request-1", status: "request_received", shopDeliveryStatus: "queued" });
    expect(dependencies.deliver).toHaveBeenCalledOnce();
    expect(dependencies.deliverCustomerConfirmation).not.toHaveBeenCalled();
    expect(dependencies.cleanupAcceptedArtwork).toHaveBeenCalledOnce();
  });

  it("surfaces a customer audit reconciliation failure without repeating either accepted email on retry", async () => {
    const { dependencies } = statefulDependencies("failed");
    dependencies.deliver = vi.fn(async () => ({ status: "provider_accepted" as const, providerId: "accepted-shop" }));
    dependencies.recordDelivery = vi.fn(async (_requestId, auditId) => {
      if (auditId === "audit-shop") return;
      throw new Error("customer audit update unavailable");
    });

    const first = await submitQuote(input, dependencies);
    const second = await submitQuote(input, dependencies);

    expect(first).toMatchObject({ kind: "audit_reconciliation_required", requestId: "request-1", deliveryType: "customer_confirmation", email: { status: "provider_accepted" } });
    expect(second.kind).toBe("duplicate");
    expect(dependencies.deliver).toHaveBeenCalledOnce();
    expect(dependencies.deliverCustomerConfirmation).toHaveBeenCalledOnce();
    expect(dependencies.cleanupAcceptedArtwork).toHaveBeenCalledOnce();
  });
});
