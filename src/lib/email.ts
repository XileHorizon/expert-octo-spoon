import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import nodemailer, { type Transporter } from "nodemailer";
import { isGmailApiConfigured, sendViaGmailApi } from "./gmail-api";
import { isResendConfigured, sendViaResend } from "./resend";

/**
 * Resend HTTPS is preferred when RESEND_API_KEY is configured. SMTP and Gmail
 * API remain compatible fallbacks when Resend is not configured.
 */

export type EmailResult = { status: "not_configured" | "queued" | "provider_accepted" | "failed"; providerId?: string; error?: string };
export type EmailAttachment = {
  filename: string;
  content: Buffer;
  contentType: string;
  /** Nodemailer/Resend Content-ID used for email-client-safe inline images. */
  cid?: string;
  contentDisposition?: "attachment" | "inline";
};

const EMAIL_LOGO_CID = "ship-print-esell-logo";
let cached: Transporter | null = null;
let cachedEmailLogo: Buffer | null = null;

function emailLogoAttachment(): EmailAttachment {
  cachedEmailLogo ??= readFileSync(resolve(process.cwd(), "src/app/assets/ship-print-email-logo.png"));
  return {
    filename: "ship-print-esell-logo.png",
    content: cachedEmailLogo,
    contentType: "image/png",
    cid: EMAIL_LOGO_CID,
    contentDisposition: "inline",
  };
}

function transport(): Transporter | null {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
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

function configuredSender(name: "QUOTE_NOTIFICATION_FROM" | "CUSTOMER_CONFIRMATION_FROM") {
  return process.env[name]?.trim() || process.env.EMAIL_FROM?.trim() || null;
}

function hasDeliveryTransport() {
  return Boolean(isResendConfigured() || process.env.SMTP_HOST || isGmailApiConfigured());
}

export function isEmailConfigured() {
  return Boolean(
    configuredSender("QUOTE_NOTIFICATION_FROM")
    && configuredSender("CUSTOMER_CONFIRMATION_FROM")
    && hasDeliveryTransport(),
  );
}

async function deliver(message: { from: string; to: string; replyTo?: string; subject: string; text: string; html?: string; attachments?: EmailAttachment[] }) {
  if (isResendConfigured()) return sendViaResend(message);
  const mailer = transport();
  if (mailer) {
    const result = await mailer.sendMail(message);
    if (!Array.isArray(result.accepted) || result.accepted.length === 0) {
      throw new Error("SMTP provider did not accept the recipient.");
    }
    return result.messageId;
  }
  if (isGmailApiConfigured()) return sendViaGmailApi(message);
  return null;
}

/** Owner-facing mail such as password resets. Throws nothing; callers stay neutral. */
export async function sendOwnerEmail(input: { to: string; subject: string; text: string }): Promise<EmailResult> {
  const from = configuredSender("CUSTOMER_CONFIRMATION_FROM") || configuredSender("QUOTE_NOTIFICATION_FROM");
  if (!from || !hasDeliveryTransport()) return { status: "not_configured" };
  try {
    const providerId = await deliver({ from, to: input.to, subject: input.subject, text: input.text });
    if (!providerId) return { status: "not_configured" };
    return { status: "provider_accepted", providerId };
  } catch (error) {
    return { status: "failed", error: error instanceof Error ? error.message : "Unknown email error" };
  }
}

export async function sendQuoteNotification(input: {
  requestId: string;
  customerEmail: string;
  recipient?: string | null;
  summary: string;
  html?: string;
  attachments?: EmailAttachment[];
}): Promise<EmailResult> {
  const to = input.recipient || process.env.QUOTE_NOTIFICATION_TO;
  const from = configuredSender("QUOTE_NOTIFICATION_FROM");
  if (!from || !hasDeliveryTransport() || !to) return { status: "not_configured" };

  try {
    const providerId = await deliver({
      from,
      to,
      replyTo: input.customerEmail,
      subject: `Quote request ${input.requestId}`,
      text: input.summary,
      html: input.html,
      attachments: [...(input.attachments ?? []), emailLogoAttachment()],
    });
    if (!providerId) return { status: "not_configured" };
    return { status: "provider_accepted", providerId };
  } catch (error) {
    return { status: "failed", error: error instanceof Error ? error.message : "Unknown email error" };
  }
}

export async function sendCustomerConfirmation(input: {
  requestId: string;
  customerEmail: string;
  text: string;
  html: string;
}): Promise<EmailResult> {
  const from = configuredSender("CUSTOMER_CONFIRMATION_FROM");
  if (!from || !hasDeliveryTransport()) return { status: "not_configured" };
  try {
    const providerId = await deliver({
      from,
      to: input.customerEmail,
      replyTo: from,
      subject: `Ship Print eSell received your request — ${input.requestId}`,
      text: input.text,
      html: input.html,
      attachments: [emailLogoAttachment()],
    });
    if (!providerId) return { status: "not_configured" };
    return { status: "provider_accepted", providerId };
  } catch (error) {
    return { status: "failed", error: error instanceof Error ? error.message : "Unknown email error" };
  }
}
