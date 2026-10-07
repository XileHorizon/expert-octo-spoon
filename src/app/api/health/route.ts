import { NextResponse } from "next/server";
import { databaseConfigurationProblem } from "@/lib/database-config";
import { isDatabaseConfigured, query } from "@/lib/db";
import { isEmailConfigured } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Readiness probe: quote intake requires the database, both senders, and an email transport. */
export async function GET() {
  const checks: Record<string, "ok" | "failed" | "not_configured"> = {
    database: "not_configured",
    email: isEmailConfigured() ? "ok" : "not_configured",
  };
  const configurationProblem = databaseConfigurationProblem();
  if (configurationProblem) {
    checks.database = "failed";
  } else if (isDatabaseConfigured()) {
    try { await query("select 1"); checks.database = "ok"; } catch { checks.database = "failed"; }
  }
  const healthy = checks.database === "ok" && checks.email === "ok";
  return NextResponse.json({ status: healthy ? "ok" : "degraded", checks, timestamp: new Date().toISOString() }, { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
