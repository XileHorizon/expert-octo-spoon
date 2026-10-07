import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApprovedOwner } from "@/lib/auth";
import { InvalidFinishingImageError, MAX_FINISHING_IMAGE_BYTES, validateFinishingImage } from "@/lib/finishing-image";
import { query, transaction } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();
const altSchema = z.string().trim().min(1, "Add alt text that describes the example image.").max(255);
const MAX_UPLOAD_BODY_BYTES = MAX_FINISHING_IMAGE_BYTES + 128 * 1024;

async function parseBoundedFormData(request: Request) {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 1) throw new InvalidFinishingImageError("Invalid image upload.");
    if (parsedLength > MAX_UPLOAD_BODY_BYTES) throw new InvalidFinishingImageError("Use an image no larger than 2 MB.");
  }

  if (!request.body) throw new InvalidFinishingImageError("Invalid image upload.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_UPLOAD_BODY_BYTES) {
      await reader.cancel();
      throw new InvalidFinishingImageError("Use an image no larger than 2 MB.");
    }
    chunks.push(value);
  }

  const contentType = request.headers.get("content-type");
  if (!contentType?.toLowerCase().startsWith("multipart/form-data;")) throw new InvalidFinishingImageError("Invalid image upload.");
  const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
  return new Request("http://localhost/upload", { method: "POST", headers: { "content-type": contentType }, body }).formData();
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApprovedOwner();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) return NextResponse.json({ error: "Invalid finishing option id." }, { status: 422 });
  let form: FormData;
  try {
    form = await parseBoundedFormData(request);
  } catch (error) {
    const message = error instanceof InvalidFinishingImageError ? error.message : "Invalid image upload.";
    const status = message.includes("no larger") ? 413 : 400;
    return NextResponse.json({ error: message }, { status });
  }
  const file = form.get("file");
  const alt = altSchema.safeParse(form.get("altText"));
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a PNG or JPEG image." }, { status: 422 });
  if (!alt.success) return NextResponse.json({ error: alt.error.issues[0]?.message }, { status: 422 });

  try {
    const image = await validateFinishingImage(file);
    await transaction(async (client) => {
      const option = await client.query("select id from finishing_options where id=? for update", [id]);
      if (!option.rows.length) throw new Error("NOT_FOUND");
      await client.query(
        `insert into finishing_option_images(finishing_id,content_type,image_data,byte_size,width,height,content_hash)
         values (?,?,?,?,?,?,?) as incoming
         on duplicate key update content_type=incoming.content_type,image_data=incoming.image_data,byte_size=incoming.byte_size,width=incoming.width,height=incoming.height,content_hash=incoming.content_hash`,
        [id, image.contentType, image.bytes, image.bytes.length, image.width, image.height, image.hash],
      );
      await client.query("update finishing_options set image_alt=? where id=?", [alt.data, id]);
    });
    await query("insert into admin_activity_log(owner_id,action,entity_type,entity_id,details) values (?,'image_save','finishing_options',?,?)", [auth.owner.id, id, JSON.stringify({ bytes: image.bytes.length, width: image.width, height: image.height })]).catch(() => null);
    return NextResponse.json({ imageUrl: `/api/finishing-options/${id}/image?v=${image.hash}`, imageAlt: alt.data });
  } catch (error) {
    if (error instanceof InvalidFinishingImageError) return NextResponse.json({ error: error.message }, { status: 422 });
    if (error instanceof Error && error.message === "NOT_FOUND") return NextResponse.json({ error: "Finishing option not found." }, { status: 404 });
    return NextResponse.json({ error: "The example image could not be saved." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApprovedOwner();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) return NextResponse.json({ error: "Invalid finishing option id." }, { status: 422 });
  try {
    const removed = await transaction(async (client) => {
      const option = await client.query("select id from finishing_options where id=? for update", [id]);
      if (!option.rows.length) throw new Error("NOT_FOUND");
      const result = await client.query("delete from finishing_option_images where finishing_id=?", [id]);
      await client.query("update finishing_options set image_alt=null where id=?", [id]);
      return result.affectedRows;
    });
    await query("insert into admin_activity_log(owner_id,action,entity_type,entity_id) values (?,'image_delete','finishing_options',?)", [auth.owner.id, id]).catch(() => null);
    return NextResponse.json({ removed: removed > 0 });
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_FOUND") return NextResponse.json({ error: "Finishing option not found." }, { status: 404 });
    return NextResponse.json({ error: "The example image could not be removed." }, { status: 500 });
  }
}
