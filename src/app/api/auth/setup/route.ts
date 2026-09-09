import { NextResponse } from "next/server";
import { z } from "zod";
import { createFirstOwner, firstOwnerSetupAvailable, passwordProblem, safeEquals } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/db";
import { firstRunSetupAvailable, prepareFirstRunDatabase, UnsafeFirstRunDatabaseError } from "@/lib/first-run-bootstrap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
  setupSecret: z.string().min(1).max(1000),
}).strict();

export async function GET() {
  if (!isDatabaseConfigured()) return NextResponse.json({ available: false, error: "The database is not configured." }, { status: 503 });
  const configured = Boolean(process.env.FIRST_OWNER_SETUP_SECRET && process.env.FIRST_OWNER_SETUP_SECRET.length >= 32);
  return NextResponse.json({ available: configured && await firstRunSetupAvailable().catch(() => false) });
}

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) return NextResponse.json({ error: "Owner setup is unavailable." }, { status: 503 });
  const deploymentSecret = process.env.FIRST_OWNER_SETUP_SECRET;
  if (!deploymentSecret || deploymentSecret.length < 32) {
    return NextResponse.json({ error: "Owner setup is not securely configured." }, { status: 503 });
  }
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Check the setup details." }, { status: 422 });
  if (!safeEquals(parsed.data.setupSecret, deploymentSecret)) return NextResponse.json({ error: "Owner setup could not be authorized." }, { status: 403 });
  const problem = passwordProblem(parsed.data.password);
  if (problem) return NextResponse.json({ error: problem }, { status: 422 });

  try {
    await prepareFirstRunDatabase();
    if (!await firstOwnerSetupAvailable()) return NextResponse.json({ error: "Owner setup is permanently closed." }, { status: 409 });
    const result = await createFirstOwner(parsed.data.email, parsed.data.password);
    if (!result.ok) return NextResponse.json({ error: "Owner setup is permanently closed." }, { status: 409 });
    return NextResponse.json({ ok: true, message: "Owner account created. Sign in to continue." }, { status: 201 });
  } catch (error) {
    if (error instanceof UnsafeFirstRunDatabaseError) {
      return NextResponse.json({ error: "Owner setup requires an empty database or a completed application database import." }, { status: 409 });
    }
    return NextResponse.json({ error: "Owner setup could not be completed." }, { status: 500 });
  }
}
