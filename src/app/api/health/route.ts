import { NextResponse } from "next/server";
import { isDatabaseConfigured, query } from "@/lib/db";
import { isEmailConfigured } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Readiness probe: quote intake requires both database and SMTP availability. */
export async function GET() {
  const checks: Record<string, "ok" | "failed" | "not_configured"> = {
    database: "not_configured",
    email: isEmailConfigured() ? "ok" : "not_configured",
  };
  if (isDatabaseConfigured()) {
    try { await query("select 1"); checks.database = "ok"; } catch { checks.database = "failed"; }
  }
  const healthy = checks.database === "ok" && checks.email === "ok";
  return NextResponse.json({ status: healthy ? "ok" : "degraded", checks, timestamp: new Date().toISOString() }, { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
