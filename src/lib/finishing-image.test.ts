import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { validateFinishingImage } from "./finishing-image";

async function png(width = 1, height = 1) {
  return sharp({ create: { width, height, channels: 4, background: { r: 20, g: 40, b: 60, alpha: 1 } } }).png().toBuffer();
}

async function jpeg(width = 2, height = 3) {
  return sharp({ create: { width, height, channels: 3, background: { r: 20, g: 40, b: 60 } } }).jpeg().toBuffer();
}

describe("finishing image validation", () => {
  it("accepts and normalizes bounded PNG and JPEG data whose declared type matches", async () => {
    const validPng = await png();
    const validJpeg = await jpeg();
    await expect(validateFinishingImage(new File([validPng], "example.png", { type: "image/png" }))).resolves.toMatchObject({ width: 1, height: 1, contentType: "image/png" });
    await expect(validateFinishingImage(new File([validJpeg], "example.jpg", { type: "image/jpeg" }))).resolves.toMatchObject({ width: 2, height: 3, contentType: "image/jpeg" });
  });

  it("rejects type spoofing, malformed data, and excessive dimensions", async () => {
    await expect(validateFinishingImage(new File([await png()], "fake.jpg", { type: "image/jpeg" }))).rejects.toThrow("not a valid");
    await expect(validateFinishingImage(new File([Buffer.alloc(30)], "bad.png", { type: "image/png" }))).rejects.toThrow("not a valid");
    await expect(validateFinishingImage(new File([await png(3001, 1)], "wide.png", { type: "image/png" }))).rejects.toThrow("3,000");
  });

  it("rejects a header-shaped PNG that cannot be decoded", async () => {
    const bytes = Buffer.alloc(45);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
    bytes.writeUInt32BE(13, 8);
    bytes.write("IHDR", 12, "ascii");
    bytes.writeUInt32BE(1, 16);
    bytes.writeUInt32BE(1, 20);
    bytes.writeUInt32BE(0, 33);
    bytes.write("IEND", 37, "ascii");
    await expect(validateFinishingImage(new File([bytes], "broken.png", { type: "image/png" }))).rejects.toThrow("not a valid");
  });
});
