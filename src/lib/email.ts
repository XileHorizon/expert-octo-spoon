import nodemailer, { type Transporter } from "nodemailer";
import { isGmailApiConfigured, sendViaGmailApi } from "./gmail-api";

/**
 * Standard SMTP delivery. Works with any provider the client chooses
 * (Resend, SES, Postmark, SendGrid, their own mail server) and stores
 * no credentials in the database or the browser.
 */

export type EmailResult = { status: "not_configured" | "queued" | "provider_accepted" | "failed"; providerId?: string; error?: string };
type Attachment = { filename: string; content: Buffer; contentType: string };

let cached: Transporter | null = null;

function transport(): Transporter | null {
  const host = process.env.SMTP_HOST;
  if (!host || !process.env.EMAIL_FROM) return null;
  if (!cached) {
    cached = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER && process.env.SMTP_PASS
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
  }
  return cached;
}

export function isEmailConfigured() {
  return Boolean(process.env.EMAIL_FROM && (process.env.SMTP_HOST || isGmailApiConfigured()));
}

async function deliver(message: { to: string; replyTo?: string; subject: string; text: string; attachments?: Attachment[] }) {
  const from = process.env.EMAIL_FROM;
  if (!from) return null;
  const mailer = transport();
  if (mailer) {
    const result = await mailer.sendMail({ from, ...message });
    return result.messageId;
  }
  if (isGmailApiConfigured()) return sendViaGmailApi({ from, ...message });
  return null;
}

/** Owner-facing mail such as password resets. Throws nothing; callers stay neutral. */
export async function sendOwnerEmail(input: { to: string; subject: string; text: string }): Promise<EmailResult> {
  if (!isEmailConfigured()) return { status: "not_configured" };
  try {
    const providerId = await deliver({ to: input.to, subject: input.subject, text: input.text });
    if (!providerId) return { status: "not_configured" };
    return { status: "provider_accepted", providerId };
  } catch (error) {
    return { status: "failed", error: error instanceof Error ? error.message : "Unknown email error" };
  }
}

export async function sendQuoteNotification(input: {
  requestId: string;
  customerEmail: string;
  summary: string;
  attachments?: Attachment[];
}): Promise<EmailResult> {
  const to = process.env.QUOTE_NOTIFICATION_TO;
  if (!isEmailConfigured() || !to) return { status: "not_configured" };

  try {
    const providerId = await deliver({ to, replyTo: input.customerEmail, subject: `Quote request ${input.requestId}`, text: input.summary, attachments: input.attachments });
    if (!providerId) return { status: "not_configured" };
    return { status: "provider_accepted", providerId };
  } catch (error) {
    return { status: "failed", error: error instanceof Error ? error.message : "Unknown email error" };
  }
}
