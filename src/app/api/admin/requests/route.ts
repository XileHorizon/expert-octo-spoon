import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApprovedOwner } from "@/lib/auth";
import { queryRows } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const listQuerySchema = z.object({
  status: z.enum(["all", "request_received", "quote_sent", "in_progress", "awaiting_payment", "fulfilled"]).default("all"),
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
    conditions.push("status = ?");
  }
  if (search) {
    params.push(`%${search}%`);
    conditions.push("(customer_name like ? or customer_email like ? or coalesce(organization,'') like ?)");
    params.push(`%${search}%`, `%${search}%`);
  }
  const where = conditions.length ? `where ${conditions.join(" and ")}` : "";

  try {
    const [rows, totals] = await Promise.all([
      queryRows(
        `select id, customer_name, customer_email, organization, status, pricing_status, calculated_total, created_at,
                (select e.status from email_deliveries e
                  where e.quote_request_id=quote_requests.id and e.delivery_type='shop_notification'
                  order by e.attempt_sequence desc limit 1) as shop_delivery_status
           from quote_requests ${where}
          order by created_at desc
          limit ? offset ?`,
        [...params, limit, offset],
      ),
      queryRows<{ count: number }>(`select count(*) as count from quote_requests ${where}`, params),
    ]);

    return NextResponse.json({ requests: rows, total: Number(totals[0]?.count ?? 0), limit, offset });
  } catch {
    return NextResponse.json({ error: "Quote requests could not be loaded." }, { status: 500 });
  }
}
