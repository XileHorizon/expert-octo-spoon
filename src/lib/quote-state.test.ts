import { describe, expect, it } from "vitest";
import { patchItemById, toggleExpandedId } from "./quote-state";

describe("independent per-file state", () => {
  const files = [
    { clientId: "a", size: "letter", paper: "20lb", quantity: 10 },
    { clientId: "b", size: "legal", paper: "22lb", quantity: 25 },
    { clientId: "c", size: "cards", paper: "100lb", quantity: 200 },
  ];

  it("edits one of three file configurations without affecting the others", () => {
    const next = patchItemById(files, "b", { size: "tabloid", paper: "80lb", quantity: 50 });
    expect(next[0]).toEqual(files[0]);
    expect(next[1]).toMatchObject({ size: "tabloid", paper: "80lb", quantity: 50 });
    expect(next[2]).toEqual(files[2]);
  });

  it("collapses and expands files independently without changing data", () => {
    const open = new Set(["a", "b", "c"]);
    const collapsed = toggleExpandedId(open, "b");
    expect([...collapsed]).toEqual(["a", "c"]);
    expect(files[1]).toMatchObject({ size: "legal", paper: "22lb", quantity: 25 });
    expect([...toggleExpandedId(collapsed, "b")]).toEqual(["a", "c", "b"]);
  });
});
