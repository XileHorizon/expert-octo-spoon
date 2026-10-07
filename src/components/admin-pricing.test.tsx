// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminPricing } from "./admin-pricing";

const config = {
  papers: [
    { id: "paper-1", name: "20 lb Bond", weight: "20 lb", category: "Uncoated", active: true, sort_order: 0 },
  ],
  sizes: [],
  finishing: [],
  bulk_tiers: [],
  minimum_order_total: "0.00",
  mode_adjustments: { color: "0.0000", black_white: "0.0000", portrait: "0.0000", landscape: "0.0000" },
  in_use: { papers: [], sizes: [] },
};

const configWithFinishing = {
  ...config,
  finishing: [{
    id: "33333333-3333-4333-8333-333333333333", name: "Contour cutting",
    information_text: "Include bleed.", image_alt: "Cut line example", image_url: "/api/finishing-options/33333333-3333-4333-8333-333333333333/image?v=abc",
    unit_price: "1.00", charge_basis: "flat_per_job", size_ids: [], active: true, sort_order: 0,
  }],
};

const configWithRate = {
  ...config,
  papers: [{ id: "11111111-1111-4111-8111-111111111111", name: "Standard", weight: "20 lb", category: "Uncoated", active: true, sort_order: 0 }],
  sizes: [{ id: "22222222-2222-4222-8222-222222222222", product_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Letter", dimensions: "8.5 × 11", base_price: "0.12", billing_unit: "printed_page", minimum_quantity: 1, max_auto_quote_quantity: null, manual_quote: false, manual_quote_message: null, included_note: null, active: true, sort_order: 0, papers: [{ material_id: "11111111-1111-4111-8111-111111111111", surcharge: "0", is_standard: true, active: true }] }],
  bulk_tiers: [{ id: "44444444-4444-4444-8444-444444444444", min_quantity: 101, unit_price: "0.11", discount_percent: null, quantity_basis: "printed_pages", material_id: null, color_mode: "black-white", sides: null, size_ids: ["22222222-2222-4222-8222-222222222222"], active: true, sort_order: 0 }],
};

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AdminPricing toolbar", () => {
  it("tracks dirty state and cancels back to the loaded pricing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(config)));
    const onDirtyChange = vi.fn();

    render(<AdminPricing section="papers" onDirtyChange={onDirtyChange} />);

    await screen.findByText("20 lb Bond");
    const cancel = screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement;
    const save = screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement;
    expect(screen.getByText("No changes")).toBeTruthy();
    expect(cancel.disabled).toBe(true);
    expect(save.disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Paper name" }), { target: { value: "Premium Bond" } });

    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    expect(cancel.disabled).toBe(false);
    expect(save.disabled).toBe(false);
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);

    fireEvent.click(cancel);

    expect((screen.getByRole("textbox", { name: "Paper name" }) as HTMLInputElement).value).toBe("20 lb Bond");
    expect(screen.getByText("No changes")).toBeTruthy();
    expect(cancel.disabled).toBe(true);
    expect(save.disabled).toBe(true);
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it("selects and edits a newly added size before it is saved", async () => {
    const withSize = { ...config, sizes: [{ id: "22222222-2222-4222-8222-222222222222", name: "Letter", dimensions: "8.5 × 11", base_price: "0.12", billing_unit: "printed_page", minimum_quantity: 1, max_auto_quote_quantity: null, manual_quote: false, manual_quote_message: null, included_note: null, active: true, sort_order: 0, papers: [] }] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(withSize)));
    render(<AdminPricing section="sizes" />);
    await screen.findByRole("button", { name: /Letter/ });

    fireEvent.click(screen.getByRole("button", { name: "＋ Add size" }));
    const added = screen.getByRole("button", { name: /New size/ });
    expect(added.getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByRole("checkbox", { name: "Active" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("20 lb Bond")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Size name"), { target: { value: "Tabloid" } });
    fireEvent.change(screen.getByLabelText("Dimensions"), { target: { value: "11 × 17" } });
    expect(screen.getByRole("button", { name: /Tabloid/ }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: /Letter/ }));
    expect((screen.getByLabelText("Size name") as HTMLInputElement).value).toBe("Letter");
    fireEvent.click(screen.getByRole("button", { name: /Tabloid/ }));
    expect((screen.getByLabelText("Dimensions") as HTMLInputElement).value).toBe("11 × 17");
  });

  it("edits and saves explicit per-mode pricing adjustments", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(config)).mockResolvedValueOnce(jsonResponse({ saved: true })).mockResolvedValueOnce(jsonResponse(config));
    vi.stubGlobal("fetch", fetchMock);
    render(<AdminPricing section="options" />);
    const color = await screen.findByRole("textbox", { name: "Full color surcharge" });
    fireEvent.change(color, { target: { value: "0.075" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const request = fetchMock.mock.calls[1][1] as RequestInit;
    expect(JSON.parse(String(request.body)).mode_adjustments).toEqual({ color: "0.075", black_white: "0.0000", portrait: "0.0000", landscape: "0.0000" });
  });

  it("edits and saves auditable scoped unit rates", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(configWithRate)).mockResolvedValueOnce(jsonResponse({ saved: true })).mockResolvedValueOnce(jsonResponse(configWithRate));
    vi.stubGlobal("fetch", fetchMock);
    render(<AdminPricing section="discounts" />);
    const rate = await screen.findByRole("textbox", { name: "Unit rate" });
    fireEvent.change(rate, { target: { value: "0.105" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const payload = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body));
    expect(payload.bulk_tiers[0]).toMatchObject({ unit_price: "0.105", color_mode: "black-white", min_quantity: 101 });
  });

  it("saves plain finishing guidance without placing image bytes or URLs in config JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(configWithFinishing)).mockResolvedValueOnce(jsonResponse({ saved: true })).mockResolvedValueOnce(jsonResponse(configWithFinishing));
    vi.stubGlobal("fetch", fetchMock);
    render(<AdminPricing section="options" />);
    const guidance = await screen.findByRole("textbox", { name: "Customer information for Contour cutting" });
    fireEvent.change(guidance, { target: { value: "Be sure to include bleed and cut lines." } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const payload = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body));
    expect(payload.finishing[0].information_text).toContain("cut lines");
    expect(payload.finishing[0].image_url).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain("image_data");
  });

  it("saves changes, exposes saving state, and announces success", async () => {
    let resolveSave: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(config))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveSave = resolve; }))
      .mockResolvedValueOnce(jsonResponse(config));
    vi.stubGlobal("fetch", fetchMock);

    render(<AdminPricing section="papers" />);
    await screen.findByText("20 lb Bond");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Paper name" }), { target: { value: "Premium Bond" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(screen.getByRole("button", { name: "Saving…" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/admin/config", expect.objectContaining({ method: "PUT" }));

    resolveSave?.(jsonResponse({ ok: true }));

    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Changes saved. Public pricing is now up to date."));
    expect(screen.getByText("Saved just now")).toBeTruthy();
    expect(screen.getAllByText(/Changes saved\. Public pricing is now up to date\./)).toHaveLength(2);
  });
});
