// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/image", () => ({
  default: ({ alt, unoptimized: _unoptimized, priority: _priority, ...props }: { alt: string; unoptimized?: boolean; priority?: boolean }) => {
    void _unoptimized; void _priority;
    return createElement("img", { ...props, alt });
  },
}));

import { QuoteBuilder } from "./quote-builder";
import type { Catalog } from "@/lib/types";

const catalog: Catalog = {
  fixtureMode: false, placeholderNotice: null, minimumOrderTotal: "0", papers: [], finishing: [], bulkTiers: [],
  modeAdjustments: { color: "0", blackWhite: "0", portrait: "0", landscape: "0" },
  products: [],
};

const finishingCatalog: Catalog = {
  ...catalog,
  finishing: [{
    id: "cut-to-size", name: "Cut to size", informationText: "Include bleed and visible cut lines.",
    imageAlt: "Example artwork with cut lines", imageUrl: "/api/finishing-options/cut-to-size/image?v=abc",
    unitPrice: "0.10", chargeBasis: "per_piece", sizeIds: [], active: true,
  }],
  products: [{
    id: "prints", name: "Prints", description: "", active: true, minimumQuantity: 1,
    sizes: [{
      id: "letter", name: "Letter", dimensions: "8.5 x 11", active: true, basePrice: "1.00",
      billingUnit: "piece", minimumQuantity: 1, manualQuote: false, includedNote: null,
      papers: [{ materialId: "paper", name: "Paper", weight: null, category: null, surcharge: "0", isStandard: true, active: true }],
    }],
  }],
};

const props = {
  maxEmailBytes: 35 * 1024 * 1024,
  contact: { phone: "(614) 459-1205", email: "support@example.test" },
};

afterEach(cleanup);

describe("public pricing disclosure", () => {
  it("states that estimates are not final and omitted discounts may lower them", () => {
    render(<QuoteBuilder initialCatalog={catalog} {...props}/>);
    const disclosure = screen.getByText(/This estimate is not final/i);
    expect(disclosure.textContent).toContain("higher than expected");
    expect(disclosure.textContent).toContain("bulk and account-negotiated discounts are not reflected");
    expect(disclosure.textContent).not.toMatch(/turnaround|delivery time/i);
    expect(screen.queryByText(/Standard turnaround|Rush turnaround/i)).toBeNull();
  });

  it("uses the requested submit button text", () => {
    render(<QuoteBuilder initialCatalog={catalog} {...props}/>);
    const button = screen.getByRole("button", { name: "Submit print request" });
    expect(button.textContent).toBe("Submit print request");
  });
});

describe("finishing option guidance", () => {
  it("renders Print options before Quantity without changing either control", async () => {
    const { container } = render(<QuoteBuilder initialCatalog={finishingCatalog} {...props}/>);
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    fireEvent.change(fileInput!, { target: { files: [new File(["not-a-pdf"], "art.png", { type: "image/png" })] } });

    const printOptions = await screen.findByRole("heading", { name: "Print options" });
    const quantity = screen.getByRole("heading", { name: "Quantity" });
    expect(printOptions.compareDocumentPosition(quantity) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByLabelText("Paper & Material Stock")).not.toBeNull();
    expect((screen.getByLabelText("Quantity for art.png") as HTMLInputElement).value).toBe("1");
  });

  it("keeps selected guidance alert and image in separate blocks outside the compact selector", async () => {
    const { container } = render(<QuoteBuilder initialCatalog={finishingCatalog} {...props}/>);
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).not.toBeNull();
    fireEvent.change(fileInput!, { target: { files: [new File(["not-a-pdf"], "art.png", { type: "image/png" })] } });

    const checkbox = await screen.findByRole("checkbox", { name: "Cut to size" });
    expect(screen.queryByRole("note")).toBeNull();
    expect(screen.queryByRole("img", { name: "Example artwork with cut lines" })).toBeNull();

    fireEvent.click(checkbox);
    const alert = await screen.findByRole("note");
    const image = screen.getByRole("img", { name: "Example artwork with cut lines" });
    const option = checkbox.closest(".finish-option");
    const selector = checkbox.closest(".finish-selector");
    const guidance = image.closest(".finish-guidance");

    expect(option).not.toBeNull();
    expect(selector).not.toBeNull();
    expect(alert.classList.contains("finish-information")).toBe(true);
    expect(guidance).not.toBeNull();
    expect(alert.parentElement).toBe(option);
    expect(guidance?.parentElement).toBe(option);
    expect(selector?.contains(alert)).toBe(false);
    expect(selector?.contains(guidance)).toBe(false);
    expect(alert.contains(guidance)).toBe(false);
    expect(checkbox.getAttribute("aria-describedby")).toBe(alert.id);
  });
});
