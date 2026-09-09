import { describe, expect, it } from "vitest";
import { estimateEncodedEmailBytes, maxRawBytesForEmail, MAX_FILE_BYTES, MAX_FILES, quoteRequestSchema, uploadLimitProblem } from "./validation";

const valid = {
  idempotencyKey: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
  customer: { name: "Test User", email: "test@example.test" },
  jobs: [{
    clientId: "j", fileName: "a.pdf", fileSize: 1, mimeType: "application/pdf", pageCount: 1,
    productId: "p", sizeId: "s", materialId: "m", quantity: 1, sides: 1 as const,
    colorMode: "color" as const, orientation: "portrait" as const, finishingIds: [],
  }],
};

const parses = (value: unknown) => quoteRequestSchema.safeParse(value).success;

describe("quote schema exact size and cardinality boundaries", () => {
  it("accepts the maximum single-file byte count and rejects one byte more", () => {
    expect(parses({ ...valid, jobs: [{ ...valid.jobs[0], fileSize: MAX_FILE_BYTES }] })).toBe(true);
    expect(parses({ ...valid, jobs: [{ ...valid.jobs[0], fileSize: MAX_FILE_BYTES + 1 }] })).toBe(false);
  });

  it("accepts exactly the maximum job count and rejects one more", () => {
    expect(parses({ ...valid, jobs: Array.from({ length: MAX_FILES }, (_, index) => ({ ...valid.jobs[0], clientId: `j-${index}` })) })).toBe(true);
    expect(parses({ ...valid, jobs: Array.from({ length: MAX_FILES + 1 }, (_, index) => ({ ...valid.jobs[0], clientId: `j-${index}` })) })).toBe(false);
  });

  it.each([
    ["quantity", 1_000_000, 1_000_001],
    ["pageCount", 10_000, 10_001],
  ])("enforces the exact %s upper boundary", (field, accepted, rejected) => {
    expect(parses({ ...valid, jobs: [{ ...valid.jobs[0], [field]: accepted }] })).toBe(true);
    expect(parses({ ...valid, jobs: [{ ...valid.jobs[0], [field]: rejected }] })).toBe(false);
  });

  it("rejects non-finite, fractional, negative, and string numeric fields", () => {
    for (const quantity of [Number.NaN, Number.POSITIVE_INFINITY, 1.5, -1, "10"]) {
      expect(parses({ ...valid, jobs: [{ ...valid.jobs[0], quantity }] })).toBe(false);
    }
  });

  it("accepts the exact MIME estimate boundary and rejects one raw byte beyond it", () => {
    const messageLimit = 10 * 1024 * 1024;
    const rawLimit = maxRawBytesForEmail(messageLimit, 2);
    expect(estimateEncodedEmailBytes(rawLimit, 2)).toBeLessThanOrEqual(messageLimit);
    expect(uploadLimitProblem(rawLimit, 2, messageLimit)).toBeNull();
    expect(uploadLimitProblem(rawLimit + 1, 2, messageLimit)).toContain("after encoding");
  });

  it("strips hostile unknown object keys instead of forwarding them", () => {
    const parsed = quoteRequestSchema.parse({
      ...valid,
      __proto__: { polluted: true },
      customer: { ...valid.customer, role: "owner" },
      jobs: [{ ...valid.jobs[0], calculatedTotal: "0.01", status: "quoted" }],
    });
    expect(parsed).not.toHaveProperty("__proto__.polluted");
    expect(parsed.customer).not.toHaveProperty("role");
    expect(parsed.jobs[0]).not.toHaveProperty("calculatedTotal");
    expect(parsed.jobs[0]).not.toHaveProperty("status");
  });
});
