import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_FINISHING_IMAGE_BYTES } from "./finishing-image";

const mocks = vi.hoisted(() => ({
  requireApprovedOwner: vi.fn(),
  query: vi.fn(),
  queryOne: vi.fn(),
  transaction: vi.fn(),
  clientQuery: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireApprovedOwner: mocks.requireApprovedOwner }));
vi.mock("@/lib/db", () => ({
  query: mocks.query,
  queryOne: mocks.queryOne,
  transaction: mocks.transaction,
}));

import { DELETE, PUT } from "@/app/api/admin/finishing-options/[id]/image/route";
import { GET } from "@/app/api/finishing-options/[id]/image/route";

const id = "11111111-1111-4111-8111-111111111111";
const context = { params: Promise.resolve({ id }) };

async function uploadRequest() {
  const bytes = await sharp({ create: { width: 2, height: 3, channels: 3, background: { r: 10, g: 20, b: 30 } } }).jpeg().toBuffer();
  const form = new FormData();
  form.set("file", new File([bytes], "cut-lines.jpg", { type: "image/jpeg" }));
  form.set("altText", "Bleed and cut-line example");
  return new Request("http://example.test/api/admin/finishing-options/id/image", { method: "PUT", body: form });
}

describe("finishing image routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApprovedOwner.mockResolvedValue({ ok: true, owner: { id: "owner-1" } });
    mocks.query.mockResolvedValue({ rows: [], affectedRows: 1 });
    mocks.transaction.mockImplementation(async (callback: (client: { query: typeof mocks.clientQuery }) => unknown) => callback({ query: mocks.clientQuery }));
    mocks.clientQuery.mockResolvedValue({ rows: [{ id }], affectedRows: 1 });
  });

  it("requires owner authentication before parsing an upload", async () => {
    mocks.requireApprovedOwner.mockResolvedValue({ ok: false, status: 401, error: "Authentication required." });
    const response = await PUT(new Request("http://example.test", { method: "PUT", body: "not multipart" }), context);
    expect(response.status).toBe(401);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("normalizes and stores an upload, returning a full SHA-256 cache version", async () => {
    const response = await PUT(await uploadRequest(), context);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.imageAlt).toBe("Bleed and cut-line example");
    expect(body.imageUrl).toMatch(new RegExp(`/api/finishing-options/${id}/image\\?v=[a-f0-9]{64}$`));
    expect(mocks.clientQuery).toHaveBeenCalledWith(expect.stringContaining("insert into finishing_option_images"), expect.arrayContaining([id, "image/jpeg"]));
  });

  it("caps a chunked request before multipart parsing", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_FINISHING_IMAGE_BYTES + 128 * 1024 + 1));
        controller.close();
      },
    });
    const request = new Request("http://example.test", {
      method: "PUT",
      headers: { "content-type": "multipart/form-data; boundary=test" },
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    const response = await PUT(request, context);
    expect(response.status).toBe(413);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("deletes image bytes and alt text together", async () => {
    const response = await DELETE(new Request("http://example.test", { method: "DELETE" }), context);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ removed: true });
    expect(mocks.clientQuery).toHaveBeenCalledWith("delete from finishing_option_images where finishing_id=?", [id]);
    expect(mocks.clientQuery).toHaveBeenCalledWith("update finishing_options set image_alt=null where id=?", [id]);
  });

  it("serves immutable image bytes with ETag revalidation", async () => {
    const hash = "a".repeat(64);
    mocks.queryOne.mockResolvedValue({ content_type: "image/png", image_data: Buffer.from([1, 2, 3]), content_hash: hash });
    const response = await GET(new Request("http://example.test"), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(response.headers.get("etag")).toBe(`"${hash}"`);

    const cached = await GET(new Request("http://example.test", { headers: { "if-none-match": `"${hash}"` } }), context);
    expect(cached.status).toBe(304);
  });
});
