import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApprovedOwner } from "@/lib/auth";
import { queryRows } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const listQuerySchema = z.object({
  status: z.enum(["all", "received", "intake_failed", "reviewing", "quoted", "closed"]).default("all"),
  search: z.string().trim().max(160).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});

export async function GET(request: Request) {
  const auth = await requireApprovedOwner();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const url = new URL(request.url);
  const parsed = listQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request filters." }, { status: 422 });
  const { status, search, limit, offset } = parsed.data;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (status !== "all") {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(customer_name ilike $${params.length} or customer_email ilike $${params.length} or coalesce(organization,'') ilike $${params.length})`);
  }
  const where = conditions.length ? `where ${conditions.join(" and ")}` : "";

  try {
    const [rows, totals] = await Promise.all([
      queryRows(
        `select id, customer_name, customer_email, organization, status, pricing_status, calculated_total, created_at
           from quote_requests ${where}
          order by created_at desc
          limit $${params.length + 1} offset $${params.length + 2}`,
        [...params, limit, offset],
      ),
      queryRows<{ count: string }>(`select count(*)::text as count from quote_requests ${where}`, params),
    ]);

    return NextResponse.json({ requests: rows, total: Number(totals[0]?.count ?? 0), limit, offset });
  } catch {
    return NextResponse.json({ error: "Quote requests could not be loaded." }, { status: 500 });
  }
}
