import { NextResponse } from "next/server";
import { z } from "zod";
import { queryOne } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();
type ImageRow = { content_type: string; image_data: Buffer; content_hash: string };

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) return new NextResponse(null, { status: 404 });
  try {
    const image = await queryOne<ImageRow>("select content_type,image_data,content_hash from finishing_option_images where finishing_id=?", [id]);
    if (!image) return new NextResponse(null, { status: 404 });
    const etag = `"${image.content_hash}"`;
    if (request.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers: { ETag: etag } });
    return new NextResponse(new Uint8Array(image.image_data), { headers: {
      "Content-Type": image.content_type,
      "Content-Length": String(image.image_data.length),
      "Content-Disposition": "inline",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      ETag: etag,
    } });
  } catch { return new NextResponse(null, { status: 503 }); }
}
