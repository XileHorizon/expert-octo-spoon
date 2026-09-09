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
