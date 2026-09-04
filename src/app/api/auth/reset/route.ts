import { NextResponse } from "next/server";
import { z } from "zod";
import { consumePasswordReset, passwordProblem } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ token: z.string().min(10).max(400), password: z.string().min(1).max(200) });

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) return NextResponse.json({ error: "The database is not configured yet." }, { status: 503 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "This reset link is not valid." }, { status: 422 });

  const problem = passwordProblem(parsed.data.password);
  if (problem) return NextResponse.json({ error: problem }, { status: 422 });

  const result = await consumePasswordReset(parsed.data.token, parsed.data.password).catch(() => ({ ok: false as const, error: "The database is unavailable. Try again shortly." }));
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json({ ok: true, message: "Your password was updated. Sign in with your new password." });
}
