import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendMail: vi.fn(),
  isGmailApiConfigured: vi.fn(() => false),
  sendViaGmailApi: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail: mocks.sendMail })),
  },
}));

vi.mock("./gmail-api", () => ({
  isGmailApiConfigured: mocks.isGmailApiConfigured,
  sendViaGmailApi: mocks.sendViaGmailApi,
}));

const originalEnv = { ...process.env };

async function emailModule() {
  vi.resetModules();
  return import("./email");
}

describe("email delivery acceptance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      EMAIL_FROM: "quotes@example.test",
      QUOTE_NOTIFICATION_TO: "shop@example.test",
      SMTP_HOST: "smtp.example.test",
    };
    delete process.env.GMAIL_OAUTH_TOKENS_PATH;
    mocks.isGmailApiConfigured.mockReturnValue(false);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("records provider acceptance only when SMTP accepts a recipient", async () => {
    mocks.sendMail.mockResolvedValue({ messageId: "message-1", accepted: ["shop@example.test"], rejected: [] });
    const { sendQuoteNotification } = await emailModule();

    await expect(sendQuoteNotification({ requestId: "quote-1", customerEmail: "customer@example.test", summary: "Summary", html: "<p>Summary</p>" }))
      .resolves.toEqual({ status: "provider_accepted", providerId: "message-1" });
    expect(mocks.sendMail).toHaveBeenCalledWith(expect.objectContaining({ text: "Summary", html: "<p>Summary</p>" }));
  });

  it("does not treat an internally generated SMTP message id as provider acceptance", async () => {
    mocks.sendMail.mockResolvedValue({ messageId: "message-2", accepted: [], rejected: ["shop@example.test"] });
    const { sendQuoteNotification } = await emailModule();

    await expect(sendQuoteNotification({ requestId: "quote-2", customerEmail: "customer@example.test", summary: "Summary" }))
      .resolves.toMatchObject({ status: "failed", error: expect.stringContaining("did not accept") });
  });

  it("records Gmail API acceptance only after the API returns a provider id", async () => {
    delete process.env.SMTP_HOST;
    process.env.GMAIL_OAUTH_TOKENS_PATH = "/redacted/token.json";
    mocks.isGmailApiConfigured.mockReturnValue(true);
    mocks.sendViaGmailApi.mockResolvedValue("gmail-message-1");
    const { sendQuoteNotification } = await emailModule();

    await expect(sendQuoteNotification({ requestId: "quote-3", customerEmail: "customer@example.test", summary: "Summary", html: "<p>Summary</p>" }))
      .resolves.toEqual({ status: "provider_accepted", providerId: "gmail-message-1" });
    expect(mocks.sendViaGmailApi).toHaveBeenCalledWith(expect.objectContaining({ text: "Summary", html: "<p>Summary</p>" }));
  });

  it("sends customer confirmation without attachments", async () => {
    mocks.sendMail.mockResolvedValue({ messageId: "message-customer", accepted: ["customer@example.test"], rejected: [] });
    const { sendCustomerConfirmation } = await emailModule();
    await expect(sendCustomerConfirmation({ requestId: "quote-4", customerEmail: "customer@example.test", text: "Received", html: "<p>Received</p>" }))
      .resolves.toEqual({ status: "provider_accepted", providerId: "message-customer" });
    expect(mocks.sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "customer@example.test", text: "Received", html: "<p>Received</p>" }));
    expect(mocks.sendMail.mock.calls[0][0]).not.toHaveProperty("attachments");
  });
});
