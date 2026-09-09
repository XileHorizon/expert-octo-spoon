import { describe, expect, it } from "vitest";
import { artworkHandoffMessage } from "./admin-requests";

describe("admin artwork handoff messaging", () => {
  it("distinguishes accepted, failed, pending, and missing delivery evidence", () => {
    expect(artworkHandoffMessage("provider_accepted")).toMatch(/accepted by the mail provider/i);
    expect(artworkHandoffMessage("failed")).toMatch(/was not accepted/i);
    expect(artworkHandoffMessage("not_configured")).toMatch(/was not accepted/i);
    expect(artworkHandoffMessage("queued")).toMatch(/requires reconciliation/i);
    expect(artworkHandoffMessage(null)).toMatch(/no shop file-handoff audit/i);
  });
});
