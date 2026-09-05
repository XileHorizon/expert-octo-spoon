import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApprovedOwner } from "@/lib/auth";
import { query, queryOne, queryRows } from "@/lib/db";
import { requestStatusSchema } from "@/lib/admin-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApprovedOwner();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) return NextResponse.json({ error: "Invalid request id." }, { status: 422 });

  try {
    const record = await queryOne("select * from quote_requests where id = ?", [id]);
    if (!record) return NextResponse.json({ error: "Request not found." }, { status: 404 });

    const [jobs, emails] = await Promise.all([
      queryRows("select * from quote_jobs where quote_request_id = ? order by created_at", [id]),
      queryRows("select * from email_deliveries where quote_request_id = ? order by created_at desc", [id]),
    ]);

    return NextResponse.json({ request: record, jobs, emails });
  } catch {
    return NextResponse.json({ error: "The request could not be loaded." }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApprovedOwner();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) return NextResponse.json({ error: "Invalid request id." }, { status: 422 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const parsed = z.object({ status: requestStatusSchema }).safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid status value." }, { status: 422 });

  try {
    await query("update quote_requests set status = ? where id = ?", [parsed.data.status, id]);
    const updated = await queryOne("select id, status, updated_at from quote_requests where id = ?", [id]);
    if (!updated) return NextResponse.json({ error: "Request not found." }, { status: 404 });
    await query("insert into admin_activity_log(owner_id, action, entity_type, entity_id) values (?,'status',?,?)", [auth.owner.id, "quote_requests", id]).catch(() => null);
    return NextResponse.json({ request: updated });
  } catch {
    return NextResponse.json({ error: "The status could not be updated." }, { status: 400 });
  }
}
