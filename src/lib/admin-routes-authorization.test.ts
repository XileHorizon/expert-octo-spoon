import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApprovedOwner: vi.fn(),
  query: vi.fn(),
  queryOne: vi.fn(),
  queryRows: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireApprovedOwner: mocks.requireApprovedOwner }));
vi.mock("@/lib/db", () => ({
  query: mocks.query,
  queryOne: mocks.queryOne,
  queryRows: mocks.queryRows,
  transaction: mocks.transaction,
}));

import { GET as getConfig, PUT as putConfig } from "@/app/api/admin/config/route";
import { GET as getSettings, PUT as putSettings } from "@/app/api/admin/settings/route";

const invalidJson = () => new Request("http://example.test/api/admin/test", {
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: "{malformed",
});

function expectNoDatabaseAccess() {
  expect(mocks.query).not.toHaveBeenCalled();
  expect(mocks.queryOne).not.toHaveBeenCalled();
  expect(mocks.queryRows).not.toHaveBeenCalled();
  expect(mocks.transaction).not.toHaveBeenCalled();
}

describe("admin route authorization boundary", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["anonymous", { ok: false as const, status: 401 as const, error: "Authentication required." }],
    ["disabled owner", { ok: false as const, status: 403 as const, error: "This owner account is disabled." }],
    ["database unavailable", { ok: false as const, status: 503 as const, error: "The database is unavailable." }],
  ])("blocks %s from every settings/config read and write before parsing or querying", async (_label, denial) => {
    mocks.requireApprovedOwner.mockResolvedValue(denial);

    const responses = await Promise.all([
      getConfig(),
      putConfig(invalidJson()),
      getSettings(),
      putSettings(invalidJson()),
    ]);

    expect(responses.map((response) => response.status)).toEqual([denial.status, denial.status, denial.status, denial.status]);
    for (const response of responses) await expect(response.json()).resolves.toMatchObject({ error: denial.error });
    expect(mocks.requireApprovedOwner).toHaveBeenCalledTimes(4);
    expectNoDatabaseAccess();
  });

  it("does not trust a caller-supplied owner identity in the body", async () => {
    mocks.requireApprovedOwner.mockResolvedValue({ ok: false, status: 401, error: "Authentication required." });
    const response = await putSettings(new Request("http://example.test/api/admin/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ owner: { id: "forged-owner", active: true }, minimum_order_total: "0.00" }),
    }));

    expect(response.status).toBe(401);
    expectNoDatabaseAccess();
  });
});
