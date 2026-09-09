import { NextResponse } from "next/server";
import { safeEquals } from "@/lib/auth";
import { processPasswordResetDeliveryQueue } from "@/lib/password-reset-delivery";
import { validatedAppOrigin } from "@/app/api/auth/request-reset/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const configured = process.env.RESET_DELIVERY_WORKER_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!configured || configured.length < 32 || !safeEquals(supplied, configured)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const origin = validatedAppOrigin();
  if (!origin) return NextResponse.json({ error: "APP_URL is not configured safely." }, { status: 503 });
  const processed = await processPasswordResetDeliveryQueue(origin, 10);
  return NextResponse.json({ ok: true, processed });
}
