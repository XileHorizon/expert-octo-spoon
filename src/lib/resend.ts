import type { EmailAttachment } from "./email";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const RESEND_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,199}$/;

type ResendMessage = {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: EmailAttachment[];
};

export function isResendConfigured() {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

/** Sends through Resend's HTTPS API without surfacing credentials or response bodies. */
export async function sendViaResend(message: ResendMessage) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new Error("Resend HTTPS transport is not configured.");

  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: message.from,
      to: [message.to],
      ...(message.replyTo ? { reply_to: message.replyTo } : {}),
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
      ...(message.attachments?.length ? {
        attachments: message.attachments.map((attachment) => ({
          filename: attachment.filename,
          content: attachment.content.toString("base64"),
          content_type: attachment.contentType,
          ...(attachment.cid ? { content_id: attachment.cid } : {}),
        })),
      } : {}),
    }),
  });

  let result: unknown;
  try { result = await response.json(); } catch { result = null; }
  const id = typeof result === "object" && result !== null && typeof (result as { id?: unknown }).id === "string"
    ? (result as { id: string }).id.trim()
    : "";
  if (!response.ok || !RESEND_ID.test(id)) {
    throw new Error(`Resend rejected the message (status ${response.status}).`);
  }
  return id;
}
