import { NextResponse } from "next/server";
import { requireApprovedOwner } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { businessSettingsSchema, defaultBusinessSettings } from "@/lib/admin-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireApprovedOwner();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const settings = await queryOne("select * from business_settings where id = 1");
    return NextResponse.json({ settings: settings ?? { ...defaultBusinessSettings } });
  } catch {
    return NextResponse.json({ error: "Business settings could not be loaded." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const auth = await requireApprovedOwner();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }); }
  const parsed = businessSettingsSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid business settings.", issues: parsed.error.flatten() }, { status: 422 });

  const value = parsed.data;
  try {
    const result = await query(
      `update business_settings set
         contact_phone = ?, contact_email = ?, turnaround_intro = ?,
         standard_turnaround = ?, rush_turnaround = ?, support_copy = ?,
         notification_target = ?, updated_by = ?
       where id = 1`,
      [value.contact_phone, value.contact_email, value.turnaround_intro, value.standard_turnaround, value.rush_turnaround, value.support_copy, value.notification_target, auth.owner.id],
    );
    if (result.affectedRows === 0) {
      const exists = await queryOne("select id from business_settings where id = 1");
      if (!exists) return NextResponse.json({ error: "Business settings row is missing. Re-run npm run db:init." }, { status: 500 });
    }
    const saved = await queryOne("select * from business_settings where id = 1");
    await query("insert into admin_activity_log(owner_id, action, entity_type) values (?,'update','business_settings')", [auth.owner.id]).catch(() => null);
    return NextResponse.json({ settings: saved });
  } catch {
    return NextResponse.json({ error: "Business settings could not be saved." }, { status: 400 });
  }
}
