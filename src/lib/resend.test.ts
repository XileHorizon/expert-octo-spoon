import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isResendConfigured, sendViaResend } from "./resend";

const originalEnv = { ...process.env };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("Resend HTTPS delivery", () => {
  beforeEach(() => {
    process.env = { ...originalEnv, RESEND_API_KEY: "test_api_key_private" };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it("maps the complete message and Base64 attachments to the HTTPS API", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: "resend_message_123" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendViaResend({
      from: "Ship Print <quotes@example.test>",
      to: "shop@example.test",
      replyTo: "customer@example.test",
      subject: "Quote request quote-1",
      text: "Plain summary",
      html: "<p>HTML summary</p>",
      attachments: [{ filename: "art.pdf", content: Buffer.from("binary-art"), contentType: "application/pdf" }],
    })).resolves.toBe("resend_message_123");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init).toMatchObject({ method: "POST", headers: { Authorization: "Bearer test_api_key_private", "Content-Type": "application/json" } });
    expect(JSON.parse(String(init.body))).toEqual({
      from: "Ship Print <quotes@example.test>",
      to: ["shop@example.test"],
      reply_to: "customer@example.test",
      subject: "Quote request quote-1",
      text: "Plain summary",
      html: "<p>HTML summary</p>",
      attachments: [{ filename: "art.pdf", content: Buffer.from("binary-art").toString("base64"), content_type: "application/pdf" }],
    });
  });

  it("maps an inline PNG Content-ID for broad email-client compatibility", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: "resend_message_inline" }));
    vi.stubGlobal("fetch", fetchMock);

    await sendViaResend({
      from: "Ship Print <quotes@example.test>", to: "shop@example.test", subject: "Subject", text: "Text",
      html: '<img src="cid:ship-print-esell-logo" alt="Ship Print eSell">',
      attachments: [{ filename: "ship-print-esell-logo.png", content: Buffer.from("png"), contentType: "image/png", cid: "ship-print-esell-logo", contentDisposition: "inline" }],
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body)).attachments).toEqual([{
      filename: "ship-print-esell-logo.png",
      content: Buffer.from("png").toString("base64"),
      content_type: "image/png",
      content_id: "ship-print-esell-logo",
    }]);
  });

  it("treats a successful response without a valid provider id as failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ id: "" })));
    await expect(sendViaResend({ from: "quotes@example.test", to: "shop@example.test", subject: "Subject", text: "Text" }))
      .rejects.toThrow("Resend rejected the message (status 200).");
  });

  it("does not leak the API key or provider response body on rejection", async () => {
    const secret = "test_api_key_private";
    const providerDetail = "sensitive-provider-detail";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ message: providerDetail, key: secret }, 403)));

    let message = "";
    try {
      await sendViaResend({ from: "quotes@example.test", to: "shop@example.test", subject: "Subject", text: "Text" });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe("Resend rejected the message (status 403).");
    expect(message).not.toContain(secret);
    expect(message).not.toContain(providerDetail);
  });

  it("requires an API key before attempting delivery", async () => {
    delete process.env.RESEND_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(isResendConfigured()).toBe(false);
    await expect(sendViaResend({ from: "quotes@example.test", to: "shop@example.test", subject: "Subject", text: "Text" }))
      .rejects.toThrow("Resend HTTPS transport is not configured.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
