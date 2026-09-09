import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireApprovedOwner } from "@/lib/auth";
import { pricingDraftSchema } from "@/lib/admin-validation";
import { query, queryRows, transaction, type DatabaseClient } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SizeRow = {
  id: string; product_id: string; name: string; dimensions: string | null; base_price: string | null;
  billing_unit: string; minimum_quantity: number; manual_quote: boolean; included_note: string | null;
  active: boolean; sort_order: number;
};

async function audit(ownerId: string, action: string, entityType: string, details: Record<string, unknown> = {}) {
  await query("insert into admin_activity_log(owner_id, action, entity_type, details) values (?,?,?,?)", [ownerId, action, entityType, JSON.stringify(details)]).catch(() => null);
}

function placeholders(values: string[]) { return values.map(() => "?").join(","); }

async function assertExisting(client: DatabaseClient, table: "materials" | "sizes" | "finishing_options" | "bulk_tiers", id: string, productId?: string) {
  const result = await client.query(`select id from ${table} where id=?${productId ? " and product_id=?" : ""} for update`, productId ? [id, productId] : [id]);
  if (!result.rows.length) throw new Error("STALE");
}

async function ensureHistorySafeRemoval(
  client: DatabaseClient,
  table: "materials" | "sizes" | "finishing_options",
  productId: string | null,
  kept: string[],
) {
  const scope = table === "materials" || table === "sizes" ? "product_id = ? and " : "";
  const scopeParams = productId ? [productId] : [];
  const omitted = kept.length ? `id not in (${placeholders(kept)})` : "1=1";
  const removed = await client.query<{ id: string }>(`select id from ${table} where ${scope}${omitted} for update`, [...scopeParams, ...kept]);
  if (!removed.rows.length) return;
  const ids = removed.rows.map((row) => row.id);
  const usageSql = table === "materials"
    ? `select material_id as id from quote_jobs where material_id in (${placeholders(ids)}) limit 1`
    : table === "sizes"
      ? `select size_id as id from quote_jobs where size_id in (${placeholders(ids)}) limit 1`
      : `select id from finishing_options where id in (${placeholders(ids)}) and exists (select 1 from quote_jobs where json_contains(finishing_ids, json_quote(finishing_options.id))) limit 1`;
  const used = await client.query<{ id: string }>(usageSql, ids);
  if (used.rows.length) throw new Error("HISTORY");
  await client.query(`delete from ${table} where id in (${placeholders(ids)})`, ids);
}

/** The whole owner-editable pricing model in one payload. */
export async function GET() {
  const auth = await requireApprovedOwner();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const [papers, sizes, sizePapers, finishing, finishingSizes, tiers, tierSizes, usage, settings] = await Promise.all([
      queryRows("select id,name,weight,category,active,sort_order from materials order by sort_order, name"),
      queryRows<SizeRow>("select id,product_id,name,dimensions,base_price,billing_unit,minimum_quantity,manual_quote,included_note,active,sort_order from sizes order by sort_order, name"),
      queryRows<{ size_id: string; material_id: string; surcharge: string | null; is_standard: boolean; active: boolean }>("select size_id,material_id,surcharge,is_standard,active from size_papers order by sort_order"),
      queryRows("select id,name,unit_price,charge_basis,active,sort_order from finishing_options order by sort_order, name"),
      queryRows<{ finishing_id: string; size_id: string }>("select finishing_id,size_id from finishing_sizes"),
      queryRows("select id,min_quantity,discount_percent,quantity_basis,active,sort_order from bulk_tiers order by min_quantity"),
      queryRows<{ tier_id: string; size_id: string }>("select tier_id,size_id from bulk_tier_sizes"),
      queryRows<{ material_id: string; size_id: string }>("select distinct material_id, size_id from quote_jobs"),
      queryRows<{ minimum_order_total: string; color_adjustment: string; black_white_adjustment: string; portrait_adjustment: string; landscape_adjustment: string }>("select minimum_order_total,color_adjustment,black_white_adjustment,portrait_adjustment,landscape_adjustment from business_settings where id = 1"),
    ]);
    return NextResponse.json({
      papers,
      sizes: sizes.map((size) => ({ ...size, papers: sizePapers.filter((link) => link.size_id === size.id).map(({ material_id, surcharge, is_standard, active }) => ({ material_id, surcharge, is_standard, active })) })),
      finishing: finishing.map((option) => ({ ...option, size_ids: finishingSizes.filter((link) => link.finishing_id === option.id).map((link) => link.size_id) })),
      bulk_tiers: tiers.map((tier) => ({ ...tier, size_ids: tierSizes.filter((link) => link.tier_id === tier.id).map((link) => link.size_id) })),
      minimum_order_total: settings[0]?.minimum_order_total ?? "0.00",
      mode_adjustments: {
        color: settings[0]?.color_adjustment ?? "0.0000",
        black_white: settings[0]?.black_white_adjustment ?? "0.0000",
        portrait: settings[0]?.portrait_adjustment ?? "0.0000",
        landscape: settings[0]?.landscape_adjustment ?? "0.0000",
      },
      in_use: { papers: [...new Set(usage.map((row) => row.material_id))], sizes: [...new Set(usage.map((row) => row.size_id))] },
    });
  } catch {
    return NextResponse.json({ error: "Pricing configuration could not be loaded." }, { status: 500 });
  }
}

/** Atomic save: validate everything, lock affected rows, then commit all tables or none. */
export async function PUT(request: Request) {
  const auth = await requireApprovedOwner();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }); }
  const parsed = pricingDraftSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the highlighted fields.", issues: parsed.error.issues.map((issue) => issue.message) }, { status: 422 });
  const draft = parsed.data;

  try {
    await transaction(async (client) => {
      const product = await client.query<{ id: string }>("select id from products order by sort_order, name limit 1 for update");
      let productId = product.rows[0]?.id;
      if (!productId) {
        productId = randomUUID();
        await client.query("insert into products(id,name,description,minimum_quantity,active,sort_order) values (?,?,?,1,true,0)", [productId, "Print products", "Owner-managed print catalog"]);
      }

      const keptPapers: string[] = [];
      for (const [index, paper] of draft.papers.entries()) {
        const id = paper.id ?? randomUUID();
        if (paper.id) await assertExisting(client, "materials", id, productId);
        if (paper.id) await client.query("update materials set name=?, weight=?, category=?, active=?, sort_order=? where id=? and product_id=?", [paper.name, paper.weight, paper.category, paper.active, index, id, productId]);
        else await client.query("insert into materials(id,product_id,name,weight,category,active,sort_order) values (?,?,?,?,?,?,?)", [id, productId, paper.name, paper.weight, paper.category, paper.active, index]);
        keptPapers.push(id);
      }

      const keptSizes: string[] = [];
      for (const [index, size] of draft.sizes.entries()) {
        const id = size.id ?? randomUUID();
        const values = [size.name, size.dimensions, size.base_price, size.billing_unit, size.minimum_quantity, size.manual_quote, size.included_note, size.active, index];
        if (size.id) await assertExisting(client, "sizes", id, productId);
        if (size.id) await client.query("update sizes set name=?, dimensions=?, base_price=?, billing_unit=?, minimum_quantity=?, manual_quote=?, included_note=?, active=?, sort_order=? where id=? and product_id=?", [...values, id, productId]);
        else await client.query("insert into sizes(id,product_id,name,dimensions,base_price,billing_unit,minimum_quantity,manual_quote,included_note,active,sort_order) values (?,?,?,?,?,?,?,?,?,?,?)", [id, productId, ...values]);
        keptSizes.push(id);
      }

      // Remove omitted sizes first (after history checks); their mapping rows cascade.
      await ensureHistorySafeRemoval(client, "sizes", productId, keptSizes);

      for (let index = 0; index < draft.sizes.length; index += 1) {
        const size = draft.sizes[index];
        const sizeId = keptSizes[index];
        await client.query("delete from size_papers where size_id=?", [sizeId]);
        for (const [paperIndex, paper] of size.papers.entries()) {
          await client.query("insert into size_papers(size_id,material_id,surcharge,is_standard,active,sort_order) values (?,?,?,?,?,?)", [sizeId, paper.material_id, paper.surcharge, paper.is_standard, paper.active, paperIndex]);
        }
      }
      // Kept size mappings no longer reference omitted papers, so safe unused papers can now go.
      await ensureHistorySafeRemoval(client, "materials", productId, keptPapers);

      const keptFinishing: string[] = [];
      for (const [index, option] of draft.finishing.entries()) {
        const id = option.id ?? randomUUID();
        if (option.id) await assertExisting(client, "finishing_options", id);
        if (option.id) await client.query("update finishing_options set name=?, unit_price=?, charge_basis=?, active=?, sort_order=? where id=?", [option.name, option.unit_price, option.charge_basis, option.active, index, id]);
        else await client.query("insert into finishing_options(id,name,unit_price,charge_basis,active,sort_order) values (?,?,?,?,?,?)", [id, option.name, option.unit_price, option.charge_basis, option.active, index]);
        keptFinishing.push(id);
        await client.query("delete from finishing_sizes where finishing_id=?", [id]);
        for (const sizeId of option.size_ids) if (keptSizes.includes(sizeId)) await client.query("insert ignore into finishing_sizes(finishing_id,size_id) values (?,?)", [id, sizeId]);
      }
      await ensureHistorySafeRemoval(client, "finishing_options", null, keptFinishing);

      const keptTiers: string[] = [];
      for (const [index, tier] of draft.bulk_tiers.entries()) {
        const id = tier.id ?? randomUUID();
        if (tier.id) await assertExisting(client, "bulk_tiers", id);
        if (tier.id) await client.query("update bulk_tiers set min_quantity=?, discount_percent=?, quantity_basis=?, active=?, sort_order=?, unit_price=null where id=?", [tier.min_quantity, tier.discount_percent, tier.quantity_basis, tier.active, index, id]);
        else await client.query("insert into bulk_tiers(id,product_id,min_quantity,discount_percent,quantity_basis,active,sort_order) values (?,null,?,?,?,?,?)", [id, tier.min_quantity, tier.discount_percent, tier.quantity_basis, tier.active, index]);
        keptTiers.push(id);
        await client.query("delete from bulk_tier_sizes where tier_id=?", [id]);
        for (const sizeId of tier.size_ids) if (keptSizes.includes(sizeId)) await client.query("insert ignore into bulk_tier_sizes(tier_id,size_id) values (?,?)", [id, sizeId]);
      }
      if (keptTiers.length) await client.query(`delete from bulk_tiers where id not in (${placeholders(keptTiers)})`, keptTiers);
      else await client.query("delete from bulk_tiers");

      await client.query(
        "update business_settings set minimum_order_total=?,color_adjustment=?,black_white_adjustment=?,portrait_adjustment=?,landscape_adjustment=?,updated_by=? where id=1",
        [draft.minimum_order_total, draft.mode_adjustments.color, draft.mode_adjustments.black_white, draft.mode_adjustments.portrait, draft.mode_adjustments.landscape, auth.owner.id],
      );
    });
  } catch (error) {
    if (error instanceof Error && error.message === "STALE") return NextResponse.json({ error: "Someone else changed this pricing. Reload before saving again." }, { status: 409 });
    const message = error instanceof Error && error.message === "HISTORY"
      ? "Nothing was saved. Deactivate records used by past quotes instead of removing them."
      : "Nothing was saved. Check every pricing selection and try again.";
    return NextResponse.json({ error: message }, { status: 409 });
  }

  await audit(auth.owner.id, "save", "pricing", { sizes: draft.sizes.length, papers: draft.papers.length });
  return NextResponse.json({ saved: true, savedAt: new Date().toISOString() });
}
