import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/database-config", () => ({ databaseConfigurationProblem: () => null }));
vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: () => true,
  query: vi.fn(async () => [{ ok: 1 }]),
}));

import { GET } from "@/app/api/health/route";

const originalEnv = { ...process.env };
afterEach(() => { process.env = { ...originalEnv }; });

describe("GET /api/health email configuration", () => {
  it("reports email ready when Resend and both split senders are configured", async () => {
    process.env.RESEND_API_KEY = "test-key";
    delete process.env.EMAIL_FROM;
    process.env.QUOTE_NOTIFICATION_FROM = "quotes@notify.example.test";
    process.env.CUSTOMER_CONFIRMATION_FROM = "info@example.test";
    delete process.env.SMTP_HOST;
    delete process.env.GMAIL_OAUTH_TOKENS_PATH;

    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok", checks: { database: "ok", email: "ok" } });
  });

  it("keeps health non-ready when no email transport is configured", async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.SMTP_HOST;
    delete process.env.GMAIL_OAUTH_TOKENS_PATH;
    process.env.EMAIL_FROM = "quotes@example.test";
    delete process.env.QUOTE_NOTIFICATION_FROM;
    delete process.env.CUSTOMER_CONFIRMATION_FROM;

    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: "degraded", checks: { database: "ok", email: "not_configured" } });
  });
});
