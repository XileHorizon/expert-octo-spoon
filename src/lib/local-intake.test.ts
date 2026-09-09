import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { claimLocalRequest } from "./local-intake";

const scratchRoot = path.join(process.cwd(), ".openclaw", "tmp");
const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("local intake idempotency", () => {
  it("atomically allows only one concurrent claim", async () => {
    await mkdir(scratchRoot, { recursive: true });
    const directory = await mkdtemp(path.join(scratchRoot, "local-intake-"));
    created.push(directory);

    const claims = await Promise.all([
      claimLocalRequest("same-key", "request-a", directory),
      claimLocalRequest("same-key", "request-b", directory),
    ]);

    expect(claims.filter((claim) => claim.kind === "claimed")).toHaveLength(1);
    const winner = claims.find((claim) => claim.kind === "claimed") === claims[0] ? "request-a" : "request-b";
    expect(claims.find((claim) => claim.kind === "duplicate")).toMatchObject({ existing: { requestId: winner, status: "processing" } });
  });

  it("never publishes a partial claim during the forced pre-publication window", async () => {
    await mkdir(scratchRoot, { recursive: true });
    const directory = await mkdtemp(path.join(scratchRoot, "local-intake-window-"));
    created.push(directory);

    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let reached!: () => void;
    const atWindow = new Promise<void>((resolve) => { reached = resolve; });
    const pending = claimLocalRequest("forced-key", "request-a", directory, async () => {
      reached();
      await blocked;
    });

    await atWindow;
    const claimPath = path.join(directory, "idempotency", "forced-key.json");
    await expect(readFile(claimPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    release();
    await expect(pending).resolves.toEqual({ kind: "claimed" });
    expect(JSON.parse(await readFile(claimPath, "utf8"))).toEqual({ requestId: "request-a", status: "processing" });
    expect((await readdir(path.dirname(claimPath))).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });
});
