import { NextResponse } from "next/server";
import { requireApprovedOwner } from "@/lib/auth";
import { queryRows } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireApprovedOwner();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const [requests, failedDeliveries, products, sizes, materials, finishing] = await Promise.all([
      queryRows<{ id: string; status: string; pricing_status: string; created_at: Date }>("select id,status,pricing_status,created_at from quote_requests"),
      queryRows<{ quote_request_id: string }>(
        `select distinct e.quote_request_id
           from email_deliveries e
          where e.status <> 'provider_accepted'
            and not exists (
              select 1 from email_deliveries newer
               where newer.quote_request_id=e.quote_request_id
                 and newer.delivery_type=e.delivery_type
                 and newer.attempt_sequence>e.attempt_sequence
            )`,
      ),
      queryRows<{ active: boolean }>("select active from products"),
      queryRows<{ active: boolean }>("select active from sizes"),
      queryRows<{ active: boolean; unit_price: string | null }>("select active, unit_price from materials"),
      queryRows<{ active: boolean; unit_price: string | null }>("select active, unit_price from finishing_options"),
    ]);

    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const byStatus = requests.reduce<Record<string, number>>((totals, row) => {
      totals[row.status] = (totals[row.status] ?? 0) + 1;
      return totals;
    }, {});

    const missingRates =
      materials.filter((row) => row.active && row.unit_price === null).length +
      finishing.filter((row) => row.active && row.unit_price === null).length;

    return NextResponse.json({
      requests: {
        total: requests.length,
        last24h: requests.filter((row) => new Date(row.created_at).getTime() >= dayAgo).length,
        manualPricing: requests.filter((row) => row.pricing_status === "manual").length,
        byStatus,
        needsAttention: new Set([
          ...requests.filter((row) => row.status === "request_received").map((row) => row.id),
          ...failedDeliveries.map((row) => row.quote_request_id),
        ]).size,
      },
      catalog: {
        activeProducts: products.filter((row) => row.active).length,
        totalProducts: products.length,
        activeSizes: sizes.filter((row) => row.active).length,
        activeMaterials: materials.filter((row) => row.active).length,
        activeFinishing: finishing.filter((row) => row.active).length,
        activeOptionsMissingRates: missingRates,
      },
    });
  } catch {
    return NextResponse.json({ error: "The dashboard could not be loaded." }, { status: 500 });
  }
}
