import { readFile, writeFile } from "node:fs/promises";
import nodemailer from "nodemailer";

type GmailTokens = {
  access_token?: string;
  token?: string;
  refresh_token?: string;
  token_uri?: string;
  client_id?: string;
  client_secret?: string;
  expiry?: string;
  expires_at?: number;
  account?: string;
};

function tokenPath() {
  return process.env.GMAIL_OAUTH_TOKENS_PATH || null;
}

async function loadTokens() {
  const file = tokenPath();
  if (!file) throw new Error("Gmail OAuth transport is not configured.");
  return { file, tokens: JSON.parse(await readFile(/* turbopackIgnore: true */ file, "utf8")) as GmailTokens };
}

function expiresSoon(tokens: GmailTokens) {
  const expiry = tokens.expires_at ?? (tokens.expiry ? new Date(tokens.expiry).getTime() : 0);
  return !expiry || expiry < Date.now() + 60_000;
}

async function accessToken() {
  const { file, tokens } = await loadTokens();
  const current = tokens.access_token ?? tokens.token;
  if (current && !expiresSoon(tokens)) return current;
  if (!tokens.refresh_token || !tokens.client_id || !tokens.client_secret) throw new Error("Gmail OAuth refresh credentials are incomplete.");

  const response = await fetch(tokens.token_uri ?? "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: tokens.client_id, client_secret: tokens.client_secret, refresh_token: tokens.refresh_token, grant_type: "refresh_token" }),
  });
  const refreshed = await response.json() as { access_token?: string; expires_in?: number; error_description?: string };
  if (!response.ok || !refreshed.access_token) throw new Error(refreshed.error_description ?? "Gmail OAuth refresh failed.");
  tokens.access_token = refreshed.access_token;
  tokens.token = refreshed.access_token;
  tokens.expires_at = Date.now() + (refreshed.expires_in ?? 3600) * 1000;
  tokens.expiry = new Date(tokens.expires_at).toISOString();
  await writeFile(file, JSON.stringify(tokens, null, 2), { mode: 0o600 });
  return refreshed.access_token;
}

export function isGmailApiConfigured() {
  return Boolean(tokenPath());
}

export async function sendViaGmailApi(message: {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
}) {
  const compiler = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
  const compiled = await compiler.sendMail(message);
  const raw = (compiled.message as Buffer).toString("base64url");
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  const result = await response.json() as { id?: string; error?: { message?: string } };
  if (!response.ok || !result.id) throw new Error(result.error?.message ?? "Gmail API rejected the message.");
  return result.id;
}
