import { after, NextResponse } from "next/server";
import { z } from "zod";
import { isDatabaseConfigured } from "@/lib/db";
import { enqueuePasswordResetDelivery, processPasswordResetDeliveryQueue } from "@/lib/password-reset-delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ email: z.string().email().max(254) });

/** Always identical, so the endpoint cannot confirm whether an address exists. */
const NEUTRAL_RESPONSE = { ok: true, message: "If that address belongs to an owner account, a reset link is on its way." };

function responseFloorMs() {
  const configured = Number(process.env.PASSWORD_RESET_RESPONSE_FLOOR_MS ?? 750);
  if (!Number.isFinite(configured)) return 750;
  return Math.min(5_000, Math.max(250, Math.floor(configured)));
}

export function validatedAppOrigin(raw = process.env.APP_URL, production = process.env.NODE_ENV === "production") {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && !production && loopback)) return null;
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) return NextResponse.json({ error: "The database is not configured yet." }, { status: 503 });
  const appOrigin = validatedAppOrigin();
  if (!appOrigin) return NextResponse.json({ error: "APP_URL must be configured as a safe public origin before password resets can be sent." }, { status: 503 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json(NEUTRAL_RESPONSE);

  const minimumDelay = new Promise((resolve) => setTimeout(resolve, responseFloorMs()));
  const queued = await enqueuePasswordResetDelivery(parsed.data.email).catch(() => false);
  if (queued) {
    after(() => processPasswordResetDeliveryQueue(appOrigin, 1).catch(() => undefined));
  }
  // Provider work starts only after the response. Known and unknown accounts both
  // wait for the same bounded floor; queue/database failures stay neutral.
  await minimumDelay;

  return NextResponse.json(NEUTRAL_RESPONSE);
}
