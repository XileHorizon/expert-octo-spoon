import { createHash } from "node:crypto";
import sharp from "sharp";

export const MAX_FINISHING_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_FINISHING_IMAGE_DIMENSION = 3000;
export const MAX_FINISHING_IMAGE_PIXELS = 9_000_000;
export const FINISHING_IMAGE_TYPES = new Set(["image/png", "image/jpeg"]);

export class InvalidFinishingImageError extends Error {}

export async function validateFinishingImage(file: File) {
  if (!FINISHING_IMAGE_TYPES.has(file.type)) throw new InvalidFinishingImageError("Use a PNG or JPEG image.");
  if (file.size < 20 || file.size > MAX_FINISHING_IMAGE_BYTES) throw new InvalidFinishingImageError("Use an image no larger than 2 MB.");

  try {
    const input = Buffer.from(await file.arrayBuffer());
    const image = sharp(input, {
      animated: false,
      failOn: "error",
      limitInputPixels: MAX_FINISHING_IMAGE_PIXELS,
      sequentialRead: true,
    });
    const metadata = await image.metadata();
    const expectedFormat = file.type === "image/png" ? "png" : "jpeg";
    if (metadata.format !== expectedFormat || (metadata.pages ?? 1) !== 1) {
      throw new InvalidFinishingImageError("The file content is not a valid PNG or JPEG image.");
    }
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    if (width < 1 || height < 1 || width > MAX_FINISHING_IMAGE_DIMENSION || height > MAX_FINISHING_IMAGE_DIMENSION || width * height > MAX_FINISHING_IMAGE_PIXELS) {
      throw new InvalidFinishingImageError("Use an image no larger than 3,000 × 3,000 pixels.");
    }

    // Fully decode and normalize the image before storage. This rejects corrupt
    // payloads and strips metadata rather than serving owner-supplied bytes.
    const pipeline = image.rotate();
    const normalized = expectedFormat === "png"
      ? await pipeline.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true })
      : await pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    if (normalized.data.length > MAX_FINISHING_IMAGE_BYTES) {
      throw new InvalidFinishingImageError("Use an image no larger than 2 MB after processing.");
    }

    return {
      bytes: normalized.data,
      contentType: file.type as "image/png" | "image/jpeg",
      width: normalized.info.width,
      height: normalized.info.height,
      hash: createHash("sha256").update(normalized.data).digest("hex"),
    };
  } catch (error) {
    if (error instanceof InvalidFinishingImageError) throw error;
    throw new InvalidFinishingImageError("The file content is not a valid PNG or JPEG image.");
  }
}
