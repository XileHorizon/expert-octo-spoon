import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_EMAIL_BYTES, MAX_FILE_BYTES, MAX_TOTAL_BYTES, estimateEncodedEmailBytes, maxRawBytesForEmail, quoteRequestSchema, uploadLimitProblem } from "./validation";

const valid = { idempotencyKey: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11", customer: { name: "Test User", email: "test@example.test" }, jobs: [{ clientId: "1", fileName: "a.pdf", fileSize: 100, mimeType: "application/pdf", pageCount: 1, productId: "p", sizeId: "s", materialId: "m", quantity: 200, sides: 1 as const, colorMode: "color" as const, orientation: "portrait" as const, finishingIds: [] }] };

describe("quote request validation", () => {
  it("accepts a bounded request", () => expect(quoteRequestSchema.safeParse(valid).success).toBe(true));
  it("rejects unsupported uploads", () => expect(quoteRequestSchema.safeParse({ ...valid, jobs: [{ ...valid.jobs[0], mimeType: "application/x-msdownload" }] }).success).toBe(false));
  it("rejects oversized files", () => expect(quoteRequestSchema.safeParse({ ...valid, jobs: [{ ...valid.jobs[0], fileSize: MAX_FILE_BYTES + 1 }] }).success).toBe(false));
  it("rejects invalid contacts", () => expect(quoteRequestSchema.safeParse({ ...valid, customer: { name: "", email: "nope" } }).success).toBe(false));
  it("requires all custom dimensions", () => expect(quoteRequestSchema.safeParse({ ...valid, jobs: [{ ...valid.jobs[0], sizeId: "custom", customWidth: "12" }] }).success).toBe(false));
  it("accepts complete custom dimensions", () => expect(quoteRequestSchema.safeParse({ ...valid, jobs: [{ ...valid.jobs[0], sizeId: "custom", customWidth: "12.5", customHeight: "18", customUnits: "in" as const }] }).success).toBe(true));
});

describe("combined email attachment limit", () => {
  it("accounts for base64 and MIME overhead", () => expect(estimateEncodedEmailBytes(3_000_000, 3)).toBeGreaterThan(4_000_000));
  it("enforces the raw total across all files", () => expect(uploadLimitProblem(MAX_TOTAL_BYTES + 1, 3, 200_000_000)).toContain("Combined"));
  it("rejects messages that fit raw but exceed the configured encoded limit", () => expect(uploadLimitProblem(20_000_000, 3, 21_000_000)).toContain("after encoding"));
  it("accepts a bounded multi-file message", () => expect(uploadLimitProblem(10_000_000, 3, 20_000_000)).toBeNull());
  it("preserves the 75 MB raw combined cap under the default encoded-message allowance", () => expect(uploadLimitProblem(MAX_TOTAL_BYTES, 10, DEFAULT_MAX_EMAIL_BYTES)).toBeNull());
  it("derives a lower visible raw cap for a smaller mail-service limit", () => {
    const cap = maxRawBytesForEmail(35 * 1024 * 1024, 3);
    expect(cap).toBeLessThan(MAX_TOTAL_BYTES);
    expect(estimateEncodedEmailBytes(cap, 3)).toBeLessThanOrEqual(35 * 1024 * 1024);
  });
});
