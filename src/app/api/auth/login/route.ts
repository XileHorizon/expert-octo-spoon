import { NextResponse } from "next/server";
import { z } from "zod";
import { createSession, findOwnerByEmail, verifyPassword } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(200) });

/** Uniform failure response and timing so this cannot be used to enumerate accounts. */
const GENERIC_FAILURE = "Those credentials did not match an active owner account.";

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) return NextResponse.json({ error: "The database is not configured yet." }, { status: 503 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: GENERIC_FAILURE }, { status: 401 });

  const owner = await findOwnerByEmail(parsed.data.email).catch(() => "DB_ERROR" as const);
  if (owner === "DB_ERROR") return NextResponse.json({ error: "The database is unavailable. Try again shortly." }, { status: 503 });

  // Always run a comparison so response timing does not reveal whether the email exists.
  const placeholder = "$2a$12$0000000000000000000000000000000000000000000000000000";
  const matches = await verifyPassword(parsed.data.password, owner?.password_hash ?? placeholder).catch(() => false);

  if (!owner || !owner.active || !matches) return NextResponse.json({ error: GENERIC_FAILURE }, { status: 401 });

  try {
    await createSession(owner.id);
  } catch {
    return NextResponse.json({ error: "Your session could not be created. Try again." }, { status: 503 });
  }
  return NextResponse.json({ ok: true, email: owner.email });
}
