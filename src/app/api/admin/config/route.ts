import { NextResponse } from "next/server";
import { requireApprovedOwner } from "@/lib/auth";
import { pricingDraftSchema } from "@/lib/admin-validation";
import { query, queryRows, transaction } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SizeRow = {
  id: string; product_id: string; name: string; dimensions: string | null; base_price: string | null;
  billing_unit: string; minimum_quantity: number; manual_quote: boolean; included_note: string | null;
  active: boolean; sort_order: number;
};

async function audit(ownerId: string, action: string, entityType: string, details: Record<string, unknown> = {}) {
  await query("insert into admin_activity_log(owner_id, action, entity_type, details) values ($1,$2,$3,$4)", [ownerId, action, entityType, details]).catch(() => null);
}

/** The whole owner-editable pricing model in one payload. */
export async function GET() {
  const auth = await requireApprovedOwner();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const [papers, sizes, sizePapers, finishing, finishingSizes, tiers, tierSizes, usage] = await Promise.all([
      queryRows("select id,name,weight,category,active,sort_order from materials order by sort_order, name"),
      queryRows<SizeRow>("select id,product_id,name,dimensions,base_price,billing_unit,minimum_quantity,manual_quote,included_note,active,sort_order from sizes order by sort_order, name"),
      queryRows<{ size_id: string; material_id: string; surcharge: string | null; is_standard: boolean; active: boolean }>("select size_id,material_id,surcharge,is_standard,active from size_papers order by sort_order"),
      queryRows("select id,name,unit_price,charge_basis,active,sort_order from finishing_options order by sort_order, name"),
      queryRows<{ finishing_id: string; size_id: string }>("select finishing_id,size_id from finishing_sizes"),
      queryRows("select id,min_quantity,discount_percent,quantity_basis,active,sort_order from bulk_tiers order by min_quantity"),
      queryRows<{ tier_id: string; size_id: string }>("select tier_id,size_id from bulk_tier_sizes"),
      queryRows<{ material_id: string; size_id: string }>("select distinct material_id, size_id from quote_jobs"),
    ]);

    return NextResponse.json({
      papers,
      sizes: sizes.map((size) => ({
        ...size,
        papers: sizePapers.filter((link) => link.size_id === size.id).map(({ material_id, surcharge, is_standard, active }) => ({ material_id, surcharge, is_standard, active })),
      })),
      finishing: finishing.map((option) => ({
        ...option,
        size_ids: finishingSizes.filter((link) => link.finishing_id === option.id).map((link) => link.size_id),
      })),
      bulk_tiers: tiers.map((tier) => ({
        ...tier,
        size_ids: tierSizes.filter((link) => link.tier_id === tier.id).map((link) => link.size_id),
      })),
      // Records that appear in quote history may be deactivated but never deleted.
      in_use: {
        papers: [...new Set(usage.map((row) => row.material_id))],
        sizes: [...new Set(usage.map((row) => row.size_id))],
      },
    });
  } catch {
    return NextResponse.json({ error: "Pricing configuration could not be loaded." }, { status: 500 });
  }
}

/** Atomic save: validate everything, then commit in one transaction or not at all. */
export async function PUT(request: Request) {
  const auth = await requireApprovedOwner();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }); }

  const parsed = pricingDraftSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the highlighted fields.", issues: parsed.error.issues.map((issue) => issue.message) }, { status: 422 });
  }
  const draft = parsed.data;

  try {
    await transaction(async (client) => {
      const product = await client.query<{ id: string }>("select id from products order by sort_order, name limit 1");
      let productId = product.rows[0]?.id;
      if (!productId) {
        const created = await client.query<{ id: string }>("insert into products(name,description,minimum_quantity,active,sort_order) values ('Print products','Owner-managed print catalog',1,true,0) returning id");
        productId = created.rows[0].id;
      }

      const keptPapers: string[] = [];
      for (const [index, paper] of draft.papers.entries()) {
        const saved = paper.id
          ? await client.query<{ id: string }>("update materials set name=$2, weight=$3, category=$4, active=$5, sort_order=$6 where id=$1 returning id", [paper.id, paper.name, paper.weight, paper.category, paper.active, index])
          : await client.query<{ id: string }>("insert into materials(product_id,name,weight,category,active,sort_order) values ($1,$2,$3,$4,$5,$6) returning id", [productId, paper.name, paper.weight, paper.category, paper.active, index]);
        if (saved.rowCount === 0) throw new Error("STALE");
        keptPapers.push(saved.rows[0].id);
      }
      await client.query("delete from materials where product_id=$1 and not (id = any($2::uuid[]))", [productId, keptPapers]);

      const keptSizes: string[] = [];
      for (const [index, size] of draft.sizes.entries()) {
        const values = [size.name, size.dimensions, size.base_price, size.billing_unit, size.minimum_quantity, size.manual_quote, size.included_note, size.active, index];
        const saved = size.id
          ? await client.query<{ id: string }>("update sizes set name=$2, dimensions=$3, base_price=$4, billing_unit=$5, minimum_quantity=$6, manual_quote=$7, included_note=$8, active=$9, sort_order=$10 where id=$1 returning id", [size.id, ...values])
          : await client.query<{ id: string }>("insert into sizes(product_id,name,dimensions,base_price,billing_unit,minimum_quantity,manual_quote,included_note,active,sort_order) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id", [productId, ...values]);
        if (saved.rowCount === 0) throw new Error("STALE");
        const sizeId = saved.rows[0].id;
        keptSizes.push(sizeId);

        await client.query("delete from size_papers where size_id=$1", [sizeId]);
        for (const [paperIndex, paper] of size.papers.entries()) {
          await client.query("insert into size_papers(size_id,material_id,surcharge,is_standard,active,sort_order) values ($1,$2,$3,$4,$5,$6)", [sizeId, paper.material_id, paper.surcharge, paper.is_standard, paper.active, paperIndex]);
        }
      }
      await client.query("delete from sizes where product_id=$1 and not (id = any($2::uuid[]))", [productId, keptSizes]);

      const keptFinishing: string[] = [];
      for (const [index, option] of draft.finishing.entries()) {
        const saved = option.id
          ? await client.query<{ id: string }>("update finishing_options set name=$2, unit_price=$3, charge_basis=$4, active=$5, sort_order=$6 where id=$1 returning id", [option.id, option.name, option.unit_price, option.charge_basis, option.active, index])
          : await client.query<{ id: string }>("insert into finishing_options(name,unit_price,charge_basis,active,sort_order) values ($1,$2,$3,$4,$5) returning id", [option.name, option.unit_price, option.charge_basis, option.active, index]);
        if (saved.rowCount === 0) throw new Error("STALE");
        const optionId = saved.rows[0].id;
        keptFinishing.push(optionId);
        await client.query("delete from finishing_sizes where finishing_id=$1", [optionId]);
        for (const sizeId of option.size_ids) {
          if (keptSizes.includes(sizeId)) await client.query("insert into finishing_sizes(finishing_id,size_id) values ($1,$2) on conflict do nothing", [optionId, sizeId]);
        }
      }
      await client.query("delete from finishing_options where not (id = any($1::uuid[]))", [keptFinishing]);

      const keptTiers: string[] = [];
      for (const [index, tier] of draft.bulk_tiers.entries()) {
        const saved = tier.id
          ? await client.query<{ id: string }>("update bulk_tiers set min_quantity=$2, discount_percent=$3, quantity_basis=$4, active=$5, sort_order=$6, unit_price=null where id=$1 returning id", [tier.id, tier.min_quantity, tier.discount_percent, tier.quantity_basis, tier.active, index])
          : await client.query<{ id: string }>("insert into bulk_tiers(product_id,min_quantity,discount_percent,quantity_basis,active,sort_order) values (null,$1,$2,$3,$4,$5) returning id", [tier.min_quantity, tier.discount_percent, tier.quantity_basis, tier.active, index]);
        if (saved.rowCount === 0) throw new Error("STALE");
        const tierId = saved.rows[0].id;
        keptTiers.push(tierId);
        await client.query("delete from bulk_tier_sizes where tier_id=$1", [tierId]);
        for (const sizeId of tier.size_ids) {
          if (keptSizes.includes(sizeId)) await client.query("insert into bulk_tier_sizes(tier_id,size_id) values ($1,$2) on conflict do nothing", [tierId, sizeId]);
        }
      }
      await client.query("delete from bulk_tiers where not (id = any($1::uuid[]))", [keptTiers]);
    });
  } catch (error) {
    if (error instanceof Error && error.message === "STALE") {
      return NextResponse.json({ error: "Someone else changed this pricing. Reload before saving again." }, { status: 409 });
    }
    const message = error instanceof Error && error.message.includes("quote history")
      ? error.message
      : "Nothing was saved. Deactivate records used by past quotes instead of removing them.";
    return NextResponse.json({ error: message }, { status: 409 });
  }

  await audit(auth.owner.id, "save", "pricing", { sizes: draft.sizes.length, papers: draft.papers.length });
  return NextResponse.json({ saved: true, savedAt: new Date().toISOString() });
}
