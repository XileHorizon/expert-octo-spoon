import { NextResponse } from "next/server";
import { getServerCatalog } from "@/lib/catalog-server";
export const dynamic="force-dynamic";
export async function GET(){return NextResponse.json(await getServerCatalog(),{headers:{"Cache-Control":"public, max-age=60, stale-while-revalidate=300"}})}
