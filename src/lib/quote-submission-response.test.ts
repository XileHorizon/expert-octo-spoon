import { describe, expect, it } from "vitest";
import { readQuoteSubmissionResponse } from "./quote-submission-response";

const contactPrompt = "Please call the print shop.";

function response(body: string, status: number, contentType = "text/html") {
  return new Response(body, { status, headers: { "content-type": contentType } });
}

describe("quote submission response handling", () => {
  it("accepts the expected JSON success response", async () => {
    await expect(readQuoteSubmissionResponse(response(
      JSON.stringify({ requestId: "request-123", pricingStatus: "priced" }),
      201,
      "application/json",
    ), contactPrompt)).resolves.toEqual({ ok: true, requestId: "request-123", pricingStatus: "priced" });
  });

  it("preserves a deliberate JSON API error", async () => {
    const result = await readQuoteSubmissionResponse(response(
      JSON.stringify({ error: "Choose a valid paper option." }),
      400,
      "application/json",
    ), contactPrompt);
    expect(result).toEqual({ ok: false, error: "Choose a valid paper option." });
  });

  it("turns an HTML 413 platform response into upload guidance without exposing HTML", async () => {
    const result = await readQuoteSubmissionResponse(response("<!DOCTYPE html><h1>Request Entity Too Large</h1>", 413), contactPrompt);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("request is too large (status 413)");
    expect(result.error).toContain("Reduce the total file size");
    expect(result.error).toContain(contactPrompt);
    expect(result.error).not.toMatch(/DOCTYPE|<h1>|Unexpected token|valid JSON/i);
  });

  it("turns an HTML upstream failure into a status-aware generic message", async () => {
    const result = await readQuoteSubmissionResponse(response("<!DOCTYPE html><title>Bad Gateway</title>", 502), contactPrompt);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("temporarily unavailable (status 502)");
    expect(result.error).toContain(contactPrompt);
    expect(result.error).not.toMatch(/DOCTYPE|Bad Gateway|Unexpected token|valid JSON/i);
  });

  it("handles a successful status with a malformed body without exposing parser details", async () => {
    const result = await readQuoteSubmissionResponse(response("not-json", 200, "text/plain"), contactPrompt);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("unexpected response (status 200)");
    expect(result.error).toContain("Check whether the request arrived before trying again");
    expect(result.error).not.toMatch(/not-json|Unexpected token|valid JSON/i);
  });
});
