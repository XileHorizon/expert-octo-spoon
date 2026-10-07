import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendMail: vi.fn(),
  isGmailApiConfigured: vi.fn(() => false),
  sendViaGmailApi: vi.fn(),
  isResendConfigured: vi.fn(() => false),
  sendViaResend: vi.fn(),
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

vi.mock("./resend", () => ({
  isResendConfigured: mocks.isResendConfigured,
  sendViaResend: mocks.sendViaResend,
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
    delete process.env.RESEND_API_KEY;
    delete process.env.QUOTE_NOTIFICATION_FROM;
    delete process.env.CUSTOMER_CONFIRMATION_FROM;
    mocks.isGmailApiConfigured.mockReturnValue(false);
    mocks.isResendConfigured.mockReturnValue(false);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("prefers Resend over stale SMTP and Gmail configuration", async () => {
    process.env.RESEND_API_KEY = "test-resend-key";
    process.env.GMAIL_OAUTH_TOKENS_PATH = "/redacted/token.json";
    mocks.isResendConfigured.mockReturnValue(true);
    mocks.isGmailApiConfigured.mockReturnValue(true);
    mocks.sendViaResend.mockResolvedValue("resend-message-1");
    const attachment = { filename: "art.pdf", content: Buffer.from("artwork"), contentType: "application/pdf" };
    const { isEmailConfigured, sendQuoteNotification } = await emailModule();

    expect(isEmailConfigured()).toBe(true);
    await expect(sendQuoteNotification({ requestId: "quote-resend", customerEmail: "customer@example.test", summary: "Summary", html: "<p>Summary</p>", attachments: [attachment] }))
      .resolves.toEqual({ status: "provider_accepted", providerId: "resend-message-1" });
    expect(mocks.sendViaResend).toHaveBeenCalledWith(expect.objectContaining({
      from: "quotes@example.test",
      to: "shop@example.test",
      replyTo: "customer@example.test",
      subject: "Quote request quote-resend",
      text: "Summary",
      html: "<p>Summary</p>",
      attachments: expect.arrayContaining([
        attachment,
        expect.objectContaining({ filename: "ship-print-esell-logo.png", contentType: "image/png", cid: "ship-print-esell-logo", contentDisposition: "inline" }),
      ]),
    }));
    expect(mocks.sendMail).not.toHaveBeenCalled();
    expect(mocks.sendViaGmailApi).not.toHaveBeenCalled();
  });

  it("recognizes Resend as configured without SMTP or Gmail", async () => {
    delete process.env.SMTP_HOST;
    process.env.RESEND_API_KEY = "test-resend-key";
    mocks.isResendConfigured.mockReturnValue(true);
    const { isEmailConfigured } = await emailModule();
    expect(isEmailConfigured()).toBe(true);
  });

  it("sends the Resend customer confirmation with only the inline logo", async () => {
    process.env.RESEND_API_KEY = "test-resend-key";
    mocks.isResendConfigured.mockReturnValue(true);
    mocks.sendViaResend.mockResolvedValue("resend-customer-1");
    const { sendCustomerConfirmation } = await emailModule();

    await expect(sendCustomerConfirmation({ requestId: "quote-5", customerEmail: "customer@example.test", text: "Received", html: "<p>Received</p>" }))
      .resolves.toEqual({ status: "provider_accepted", providerId: "resend-customer-1" });
    expect(mocks.sendViaResend).toHaveBeenCalledWith(expect.objectContaining({
      from: "quotes@example.test", to: "customer@example.test", replyTo: "quotes@example.test", text: "Received", html: "<p>Received</p>",
      attachments: [expect.objectContaining({ filename: "ship-print-esell-logo.png", contentType: "image/png", cid: "ship-print-esell-logo", contentDisposition: "inline" })],
    }));
  });

  it("uses separate notification and customer senders with the intended Reply-To addresses", async () => {
    delete process.env.EMAIL_FROM;
    process.env.QUOTE_NOTIFICATION_FROM = "quotes@notify.shipprintesell.com";
    process.env.CUSTOMER_CONFIRMATION_FROM = "info@shipprintesell.com";
    process.env.RESEND_API_KEY = "test-resend-key";
    mocks.isResendConfigured.mockReturnValue(true);
    mocks.sendViaResend.mockResolvedValueOnce("internal-1").mockResolvedValueOnce("customer-1");
    const { isEmailConfigured, sendCustomerConfirmation, sendQuoteNotification } = await emailModule();

    expect(isEmailConfigured()).toBe(true);
    await sendQuoteNotification({ requestId: "quote-split", customerEmail: "customer@example.test", summary: "Summary" });
    await sendCustomerConfirmation({ requestId: "quote-split", customerEmail: "customer@example.test", text: "Received", html: "<p>Received</p>" });

    expect(mocks.sendViaResend).toHaveBeenNthCalledWith(1, expect.objectContaining({
      from: "quotes@notify.shipprintesell.com",
      to: "shop@example.test",
      replyTo: "customer@example.test",
    }));
    expect(mocks.sendViaResend).toHaveBeenNthCalledWith(2, expect.objectContaining({
      from: "info@shipprintesell.com",
      to: "customer@example.test",
      replyTo: "info@shipprintesell.com",
    }));
  });

  it("falls back to EMAIL_FROM for both message types when split senders are absent", async () => {
    mocks.sendMail.mockResolvedValue({ messageId: "fallback-message", accepted: ["recipient@example.test"], rejected: [] });
    const { sendCustomerConfirmation, sendQuoteNotification } = await emailModule();

    await sendQuoteNotification({ requestId: "quote-fallback", customerEmail: "customer@example.test", summary: "Summary" });
    await sendCustomerConfirmation({ requestId: "quote-fallback", customerEmail: "customer@example.test", text: "Received", html: "<p>Received</p>" });

    expect(mocks.sendMail).toHaveBeenNthCalledWith(1, expect.objectContaining({ from: "quotes@example.test", replyTo: "customer@example.test" }));
    expect(mocks.sendMail).toHaveBeenNthCalledWith(2, expect.objectContaining({ from: "quotes@example.test", replyTo: "quotes@example.test" }));
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

  it("sends customer confirmation without artwork attachments", async () => {
    mocks.sendMail.mockResolvedValue({ messageId: "message-customer", accepted: ["customer@example.test"], rejected: [] });
    const { sendCustomerConfirmation } = await emailModule();
    await expect(sendCustomerConfirmation({ requestId: "quote-4", customerEmail: "customer@example.test", text: "Received", html: "<p>Received</p>" }))
      .resolves.toEqual({ status: "provider_accepted", providerId: "message-customer" });
    expect(mocks.sendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: "customer@example.test", text: "Received", html: "<p>Received</p>",
      attachments: [expect.objectContaining({ filename: "ship-print-esell-logo.png", contentType: "image/png", cid: "ship-print-esell-logo", contentDisposition: "inline" })],
    }));
  });
});
