import { NextResponse } from "next/server";
import { z } from "zod";
import { createPasswordReset, findOwnerByEmail, purgeExpiredAuthRecords } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/db";
import { sendOwnerEmail } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ email: z.string().email().max(254) });

/** Always identical, so the endpoint cannot confirm whether an address exists. */
const NEUTRAL_RESPONSE = { ok: true, message: "If that address belongs to an owner account, a reset link is on its way." };

function resetUrl(token: string) {
  const base = (process.env.APP_URL ?? "").replace(/\/$/, "");
  return `${base}/admin/reset?token=${encodeURIComponent(token)}`;
}

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) return NextResponse.json({ error: "The database is not configured yet." }, { status: 503 });
  if (!process.env.APP_URL) return NextResponse.json({ error: "APP_URL must be configured before password resets can be sent." }, { status: 503 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json(NEUTRAL_RESPONSE);

  await purgeExpiredAuthRecords().catch(() => null);
  const owner = await findOwnerByEmail(parsed.data.email).catch(() => null);
  if (!owner || !owner.active) return NextResponse.json(NEUTRAL_RESPONSE);

  try {
    const reset = await createPasswordReset(owner.id);
    await sendOwnerEmail({
      to: owner.email,
      subject: "Reset your Ship Print eSell owner password",
      text: [
        "A password reset was requested for your Ship Print eSell owner account.",
        "",
        `Open this link to choose a new password: ${resetUrl(reset.token)}`,
        "",
        `The link expires in ${reset.ttlMinutes} minutes and can be used once.`,
        "If you did not request this, you can ignore this message and your password will stay unchanged.",
      ].join("\n"),
    });
  } catch {
    // Stay neutral: never reveal whether the address exists or that delivery failed.
  }

  return NextResponse.json(NEUTRAL_RESPONSE);
}
