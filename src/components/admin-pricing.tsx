"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Decimal from "decimal.js";
import {
  BILLING_UNIT_LABELS, CHARGE_BASIS_LABELS, QUANTITY_BASIS_LABELS,
  type BillingUnit, type ChargeBasis, type QuantityBasis,
} from "@/lib/types";
import { priceJob } from "@/lib/pricing";
import { draftToCatalog, type PaperDraft, type PricingDraftState, type SizeDraft } from "@/lib/pricing-draft";

type Section = "papers" | "sizes" | "options" | "discounts";
type Loaded = { draft: PricingDraftState; inUse: { papers: string[]; sizes: string[] } };

const SECTIONS: { id: Section; label: string; icon: string }[] = [
  { id: "papers", label: "Paper types", icon: "file" },
  { id: "sizes", label: "Sizes & pricing", icon: "tag" },
  { id: "options", label: "Print options & finishing", icon: "sliders" },
  { id: "discounts", label: "Bulk discounts", icon: "percent" },
];

const Icon = ({ name }: { name: string }) => {
  const paths: Record<string, React.ReactNode> = {
    file: <><path d="M8.75 1.25H3.75a1.25 1.25 0 0 0-1.25 1.25v10a1.25 1.25 0 0 0 1.25 1.25h7.5a1.25 1.25 0 0 0 1.25-1.25V5z"/><path d="M8.75 1.25V5h3.75"/></>,
    tag: <><path d="m13.4 8.1-5.3 5.3a1.2 1.2 0 0 1-1.7 0L1.7 8.7V1.7h7l4.7 4.7a1.2 1.2 0 0 1 0 1.7z"/><circle cx="4.7" cy="4.7" r="0.9"/></>,
    sliders: <><path d="M2.5 12.5v-4M2.5 5.5v-4M7.5 12.5v-6M7.5 3.5v-2M12.5 12.5v-3M12.5 6.5v-5M1 8.5h3M6 3.5h3M11 9.5h3"/></>,
    percent: <><path d="M13 2 3 13"/><circle cx="4.2" cy="4.2" r="1.7"/><circle cx="11.8" cy="10.8" r="1.7"/></>,
  };
  return <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
};

const money = (value: string | null) => value === null ? "—" : `$${new Decimal(value).toDecimalPlaces(2).toFixed(2)}`;
const paperLabel = (paper: { name: string; weight: string | null }) => [paper.name, paper.weight].filter(Boolean).join(" · ");

export function AdminPricing({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const [section, setSection] = useState<Section>("papers");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [draft, setDraft] = useState<PricingDraftState | null>(null);
  const [error, setError] = useState("");
  const [issues, setIssues] = useState<string[]>([]);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedSizeId, setSelectedSizeId] = useState<string | null>(null);
  const liveRegion = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/config");
    const data = await response.json();
    if (!response.ok) return setError(data.error ?? "Pricing could not be loaded.");
    const next: PricingDraftState = {
      papers: data.papers, sizes: data.sizes, finishing: data.finishing, bulkTiers: data.bulk_tiers,
    };
    setLoaded({ draft: structuredClone(next), inUse: data.in_use });
    setDraft(next);
    setSelectedSizeId((current) => current ?? next.sizes[0]?.id ?? null);
  }, []);

  useEffect(() => {
    const task = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(task);
  }, [load]);

  const dirty = useMemo(() => Boolean(draft && loaded && JSON.stringify(draft) !== JSON.stringify(loaded.draft)), [draft, loaded]);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function update(mutate: (current: PricingDraftState) => PricingDraftState) {
    setDraft((current) => current ? mutate(structuredClone(current)) : current);
    setError(""); setIssues([]);
  }

  async function save() {
    if (!draft) return;
    setSaving(true); setError(""); setIssues([]);
    const response = await fetch("/api/admin/config", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        papers: draft.papers,
        sizes: draft.sizes.map((size) => {
          const clean = { ...size };
          delete clean.product_id;
          return clean;
        }),
        finishing: draft.finishing,
        bulk_tiers: draft.bulkTiers,
      }),
    });
    const data = await response.json();
    setSaving(false);
    if (!response.ok) {
      setError(data.error ?? "Nothing was saved.");
      setIssues(Array.isArray(data.issues) ? data.issues.slice(0, 6) : []);
      return;
    }
    setSavedAt(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
    await load();
    if (liveRegion.current) liveRegion.current.textContent = "Changes saved. Public pricing is now up to date.";
  }

  function revert() {
    if (!loaded) return;
    setDraft(structuredClone(loaded.draft));
    setError(""); setIssues([]);
  }

  if (error && !draft) return <div className="portal-error" role="alert">{error}</div>;
  if (!draft || !loaded) return <p className="portal-loading">Loading pricing…</p>;

  const selectedSize = draft.sizes.find((size) => size.id === selectedSizeId) ?? draft.sizes[0] ?? null;

  return <div className="portal">
    <aside className="portal-sidebar">
      <div className="portal-brand"><span aria-hidden="true">SP</span><p>ShipPrinteSell</p></div>
      <nav aria-label="Pricing sections">
        {SECTIONS.map((item) => <button key={item.id} type="button" className={section === item.id ? "active" : ""} aria-current={section === item.id ? "page" : undefined} onClick={() => setSection(item.id)}>
          <Icon name={item.icon}/><span>{item.label}</span>
        </button>)}
      </nav>
      <div className="portal-help"><p>Need a hand?</p><small>Call (614) 459-1205</small></div>
    </aside>

    <div className="portal-workspace">
      <div className="portal-content">
        <div ref={liveRegion} className="sr-only" role="status" aria-live="polite"/>
        {savedAt && !dirty && <div className="portal-saved"><p>✓ Changes saved. Public pricing is now up to date.</p><small>Saved at {savedAt}</small></div>}
        {error && <div className="portal-error" role="alert"><strong>{error}</strong>{issues.length > 1 && <ul>{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}</div>}

        {section === "papers" && <PapersScreen draft={draft} inUse={loaded.inUse.papers} update={update}/>}
        {section === "sizes" && <SizesScreen draft={draft} size={selectedSize} inUse={loaded.inUse.sizes} onSelect={setSelectedSizeId} update={update}/>}
        {section === "options" && <OptionsScreen draft={draft} update={update}/>}
        {section === "discounts" && <DiscountsScreen draft={draft} update={update}/>}
      </div>

      <div className="portal-toolbar">
        <div>
          <span className={dirty ? "chip warn" : "chip ok"}>{dirty ? "Unsaved changes" : savedAt ? "Saved just now" : "No changes"}</span>
          <small>Public prices change only after saving</small>
        </div>
        <div className="portal-actions">
          <button type="button" onClick={revert} disabled={!dirty || saving}>Cancel</button>
          <button type="button" className="primary" onClick={() => void save()} disabled={!dirty || saving}>{saving ? "Saving…" : "Save changes"}</button>
        </div>
      </div>
    </div>
  </div>;
}

function PapersScreen({ draft, inUse, update }: { draft: PricingDraftState; inUse: string[]; update: (fn: (current: PricingDraftState) => PricingDraftState) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const active = draft.papers.filter((paper) => paper.active).length;

  function addPaper() {
    const paper: PaperDraft = { name: "New paper", weight: null, category: null, active: true, sort_order: draft.papers.length };
    update((current) => ({ ...current, papers: [...current.papers, paper] }));
    setEditing("new");
  }

  return <section>
    <header className="portal-heading"><h1>Paper types</h1><p>Keep one simple catalog of papers. Pricing is assigned separately under Sizes &amp; pricing.</p></header>
    <div className="portal-card">
      <div className="portal-card-head">
        <p>{active} active {active === 1 ? "paper" : "papers"}</p>
        <button type="button" className="primary" onClick={addPaper}>＋ Add paper</button>
      </div>
      {draft.papers.length === 0 ? <p className="portal-empty">No papers yet. Add the papers your shop stocks.</p> : <table className="portal-table">
        <thead><tr><th>Paper name</th><th>Weight</th><th>Category / finish</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>{draft.papers.map((paper, index) => {
          const key = paper.id ?? `new-${index}`;
          const isEditing = editing === key || (!paper.id && editing === "new" && index === draft.papers.length - 1);
          const used = paper.id ? inUse.includes(paper.id) : false;
          const change = (patch: Partial<PaperDraft>) => update((current) => ({ ...current, papers: current.papers.map((item, i) => i === index ? { ...item, ...patch } : item) }));
          return <tr key={key}>
            <td>{isEditing ? <input aria-label="Paper name" value={paper.name} onChange={(event) => change({ name: event.target.value })}/> : paper.name}</td>
            <td>{isEditing ? <input aria-label="Weight" value={paper.weight ?? ""} placeholder="20 lb" onChange={(event) => change({ weight: event.target.value || null })}/> : paper.weight ?? "—"}</td>
            <td>{isEditing ? <input aria-label="Category or finish" value={paper.category ?? ""} placeholder="Uncoated" onChange={(event) => change({ category: event.target.value || null })}/> : paper.category ?? "—"}</td>
            <td>{isEditing ? <label className="portal-check"><input type="checkbox" checked={paper.active} onChange={(event) => change({ active: event.target.checked })}/> Active</label> : <span className={paper.active ? "state on" : "state off"}>{paper.active ? "Active" : "Hidden"}</span>}</td>
            <td className="portal-row-actions">
              <button type="button" className="link" onClick={() => setEditing(isEditing ? null : key)}>{isEditing ? "Done" : "Edit"}</button>
              {!used && <button type="button" className="link danger" onClick={() => {
                if (!window.confirm(`Remove ${paper.name}? It will also be removed from every size after Save changes.`)) return;
                update((current) => ({
                  ...current,
                  papers: current.papers.filter((_, i) => i !== index),
                  sizes: current.sizes.map((size) => ({ ...size, papers: size.papers.filter((link) => link.material_id !== paper.id) })),
                }));
              }}>Remove</button>}
            </td>
          </tr>;
        })}</tbody>
      </table>}
      <p className="portal-note">Paper names and details live here. Add each paper to specific sizes and set its surcharge under Sizes &amp; pricing.</p>
    </div>
  </section>;
}

function SizesScreen({ draft, size, inUse, onSelect, update }: { draft: PricingDraftState; size: SizeDraft | null; inUse: string[]; onSelect: (id: string) => void; update: (fn: (current: PricingDraftState) => PricingDraftState) => void }) {
  const [addingPaper, setAddingPaper] = useState("");
  if (!size) return <p className="portal-empty">No print sizes configured yet.</p>;
  const index = draft.sizes.findIndex((item) => item.id === size.id);
  const change = (patch: Partial<SizeDraft>) => update((current) => ({ ...current, sizes: current.sizes.map((item, i) => i === index ? { ...item, ...patch } : item) }));
  const unit = BILLING_UNIT_LABELS[size.billing_unit].toLowerCase();
  const availablePapers = draft.papers.filter((paper) => paper.id && paper.active && !size.papers.some((link) => link.material_id === paper.id));

  return <section>
    <header className="portal-heading"><h1>Sizes &amp; pricing</h1><p>Choose a size, then edit only the details that matter.</p></header>

    <div className="portal-card">
      <div className="portal-card-head"><h2 className="portal-subhead">Print sizes</h2><button type="button" className="primary" onClick={() => update((current) => ({ ...current, sizes: [...current.sizes, { name: "New size", dimensions: null, base_price: null, billing_unit: "piece", minimum_quantity: 1, manual_quote: true, included_note: null, active: false, sort_order: current.sizes.length, papers: [] }] }))}>＋ Add size</button></div>
      <div className="size-grid">{draft.sizes.map((item) => <button key={item.id} type="button" className={item.id === size.id ? "size-option active" : "size-option"} aria-pressed={item.id === size.id} onClick={() => item.id && onSelect(item.id)}>
        <strong>{item.name}</strong>
        <small>{item.dimensions ?? "—"}</small>
        <em>{item.manual_quote ? "Manual quote" : money(item.base_price)}</em>
      </button>)}</div>
      {draft.sizes.some((item) => !item.id) && <p className="portal-note">Save once to create new sizes, then select them to finish pricing.</p>}
    </div>

    <div className="portal-card">
      <div className="portal-card-head">
        <h2 className="portal-subhead">{size.name}{size.dimensions ? ` — ${size.dimensions}` : ""}</h2>
        <div className="portal-row-actions">
          <label className="portal-check"><input type="checkbox" checked={size.active} onChange={(event) => change({ active: event.target.checked })}/> Active</label>
          {size.id && !inUse.includes(size.id) && <button type="button" className="link danger" onClick={() => {
            if (!window.confirm(`Remove ${size.name}? This takes effect only after Save changes.`)) return;
            update((current) => ({ ...current, sizes: current.sizes.filter((item) => item.id !== size.id) }));
            const replacement = draft.sizes.find((item) => item.id !== size.id)?.id;
            if (replacement) onSelect(replacement);
          }}>Remove size</button>}
          {size.id && inUse.includes(size.id) && <small className="portal-note">Used in quote history — deactivate instead of deleting.</small>}
        </div>
      </div>
      <div className="chip-row">
        <span className={size.manual_quote ? "chip warn" : "chip ok"}>{size.manual_quote ? "Manual quote only" : "Automatic estimating"}</span>
      </div>

      <div className="portal-fields">
        <label>Size name<input value={size.name} onChange={(event) => change({ name: event.target.value })}/></label>
        <label>Dimensions<input value={size.dimensions ?? ""} placeholder="8.5 × 11" onChange={(event) => change({ dimensions: event.target.value || null })}/></label>
        <label>Base price
          <input inputMode="decimal" value={size.base_price ?? ""} placeholder="0.00" disabled={size.manual_quote} onChange={(event) => change({ base_price: event.target.value || null })}/>
          <small>{size.manual_quote ? "Not used while this size is a manual quote." : `Charged ${unit}.`}</small>
        </label>
        <label>Billing unit
          <select value={size.billing_unit} onChange={(event) => change({ billing_unit: event.target.value as BillingUnit })}>
            {Object.entries(BILLING_UNIT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>Minimum quantity<input type="number" min={1} value={size.minimum_quantity} onChange={(event) => change({ minimum_quantity: Math.max(1, Number(event.target.value) || 1) })}/></label>
        <label className="portal-check wide"><input type="checkbox" checked={size.manual_quote} onChange={(event) => change({ manual_quote: event.target.checked })}/> Always quote this size manually</label>
      </div>
      <label className="portal-field-wide">Included note<input value={size.included_note ?? ""} placeholder="Included: Standard 20 lb paper, black-and-white, single-sided" onChange={(event) => change({ included_note: event.target.value || null })}/></label>
    </div>

    <div className="portal-card">
      <div className="portal-card-head">
        <h2 className="portal-subhead">Available paper for {size.name}</h2>
        <div className="portal-inline-add">
          <select aria-label="Add existing paper" value={addingPaper} onChange={(event) => setAddingPaper(event.target.value)}>
            <option value="">Add existing paper…</option>
            {availablePapers.map((paper) => <option key={paper.id} value={paper.id}>{paperLabel(paper)}</option>)}
          </select>
          <button type="button" disabled={!addingPaper} onClick={() => {
            change({ papers: [...size.papers, { material_id: addingPaper, surcharge: "0", is_standard: size.papers.length === 0, active: true }] });
            setAddingPaper("");
          }}>Add</button>
        </div>
      </div>
      {size.papers.length === 0 ? <p className="portal-empty">No paper is offered for this size yet.</p> : <table className="portal-table">
        <thead><tr><th>Paper</th><th>Weight</th><th>Surcharge / {unit.replace(/^per /, "")}</th><th>Resulting price</th><th>Control</th></tr></thead>
        <tbody>{size.papers.map((link, paperIndex) => {
          const paper = draft.papers.find((item) => item.id === link.material_id);
          const resulting = size.base_price !== null && link.surcharge !== null
            ? money(new Decimal(size.base_price).plus(link.surcharge).toFixed(4))
            : "Manual quote";
          const patchPaper = (patch: Partial<typeof link>) => change({ papers: size.papers.map((item, i) => i === paperIndex ? { ...item, ...patch } : item) });
          return <tr key={link.material_id}>
            <td>{paper?.name ?? "Unknown paper"}{link.is_standard && <span className="tag">Standard</span>}</td>
            <td>{paper?.weight ?? "—"}</td>
            <td>{link.is_standard ? <em>Included</em> : <input aria-label={`Surcharge for ${paper?.name ?? "paper"}`} inputMode="decimal" value={link.surcharge ?? ""} placeholder="Manual" onChange={(event) => patchPaper({ surcharge: event.target.value || null })}/>}</td>
            <td>{resulting}</td>
            <td className="portal-row-actions">
              {!link.is_standard && <button type="button" className="link" onClick={() => change({ papers: size.papers.map((item, i) => ({ ...item, is_standard: i === paperIndex, surcharge: i === paperIndex ? "0" : item.surcharge })) })}>Make standard</button>}
              <button type="button" className="link" onClick={() => patchPaper({ active: !link.active })}>{link.active ? "Disable" : "Enable"}</button>
              <button type="button" className="link danger" onClick={() => change({ papers: size.papers.filter((_, i) => i !== paperIndex) })}>Remove</button>
            </td>
          </tr>;
        })}</tbody>
      </table>}
      {size.included_note && <p className="portal-note">{size.included_note}</p>}
    </div>

    <QuotePreview draft={draft} sizeId={size.id ?? ""}/>
  </section>;
}

function OptionsScreen({ draft, update }: { draft: PricingDraftState; update: (fn: (current: PricingDraftState) => PricingDraftState) => void }) {
  return <section>
    <header className="portal-heading"><h1>Print options &amp; finishing</h1><p>Set optional charges and where they apply.</p></header>
    <div className="portal-card">
      <div className="portal-card-head">
        <div className="portal-legend"><p>Per piece = multiplied by printed item count</p><p>Per job = charged once</p></div>
        <button type="button" className="primary" onClick={() => update((current) => ({ ...current, finishing: [...current.finishing, { name: "New option", unit_price: null, charge_basis: "per_piece", size_ids: [], active: true, sort_order: current.finishing.length }] }))}>＋ Add option</button>
      </div>
      {draft.finishing.length === 0 ? <p className="portal-empty">No finishing options yet.</p> : <table className="portal-table">
        <thead><tr><th>Option name</th><th>Charge</th><th>Charge basis</th><th>Applicable sizes</th><th>Status</th></tr></thead>
        <tbody>{draft.finishing.map((option, index) => {
          const change = (patch: Partial<typeof option>) => update((current) => ({ ...current, finishing: current.finishing.map((item, i) => i === index ? { ...item, ...patch } : item) }));
          return <tr key={option.id ?? `new-${index}`}>
            <td><input aria-label="Option name" value={option.name} onChange={(event) => change({ name: event.target.value })}/></td>
            <td><input aria-label={`Charge for ${option.name}`} inputMode="decimal" value={option.unit_price ?? ""} placeholder="Manual" onChange={(event) => change({ unit_price: event.target.value || null })}/></td>
            <td><select aria-label={`Charge basis for ${option.name}`} value={option.charge_basis} onChange={(event) => change({ charge_basis: event.target.value as ChargeBasis })}>
              {Object.entries(CHARGE_BASIS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></td>
            <td><SizePicker sizes={draft.sizes} selected={option.size_ids} onChange={(size_ids) => change({ size_ids })}/></td>
            <td className="portal-row-actions">
              <label className="portal-check"><input type="checkbox" checked={option.active} onChange={(event) => change({ active: event.target.checked })}/> Active</label>
              <button type="button" className="link danger" onClick={() => {
                if (!window.confirm(`Remove ${option.name}? The change is staged until you save.`)) return;
                update((current) => ({ ...current, finishing: current.finishing.filter((_, i) => i !== index) }));
              }}>Remove</button>
            </td>
          </tr>;
        })}</tbody>
      </table>}
      <p className="portal-note tint">Choose the charge basis in plain language so customers see predictable totals.</p>
    </div>
  </section>;
}

function DiscountsScreen({ draft, update }: { draft: PricingDraftState; update: (fn: (current: PricingDraftState) => PricingDraftState) => void }) {
  return <section>
    <header className="portal-heading"><h1>Bulk discounts</h1><p>Reward larger orders with simple quantity thresholds.</p></header>
    <div className="portal-card">
      <div className="portal-card-head">
        <p>Count quantity as <strong>{QUANTITY_BASIS_LABELS[draft.bulkTiers[0]?.quantity_basis ?? "printed_pages"]}</strong></p>
        <button type="button" className="primary" onClick={() => update((current) => ({ ...current, bulkTiers: [...current.bulkTiers, { min_quantity: 100, discount_percent: "5", quantity_basis: current.bulkTiers[0]?.quantity_basis ?? "printed_pages", size_ids: [], active: true, sort_order: current.bulkTiers.length }] }))}>＋ Add threshold</button>
      </div>
      {draft.bulkTiers.length === 0 ? <p className="portal-empty">No bulk discounts yet.</p> : <table className="portal-table">
        <thead><tr><th>Starts at</th><th>Discount</th><th>Applies to print sizes</th><th>Counted as</th><th>Status</th></tr></thead>
        <tbody>{draft.bulkTiers.map((tier, index) => {
          const change = (patch: Partial<typeof tier>) => update((current) => ({ ...current, bulkTiers: current.bulkTiers.map((item, i) => i === index ? { ...item, ...patch } : item) }));
          return <tr key={tier.id ?? `new-${index}`}>
            <td><input aria-label="Threshold quantity" type="number" min={1} value={tier.min_quantity} onChange={(event) => change({ min_quantity: Math.max(1, Number(event.target.value) || 1) })}/></td>
            <td><span className="suffix-field"><input aria-label="Discount percent" inputMode="decimal" value={tier.discount_percent ?? ""} onChange={(event) => change({ discount_percent: event.target.value || null })}/><b>% off</b></span></td>
            <td><SizePicker sizes={draft.sizes} selected={tier.size_ids} onChange={(size_ids) => change({ size_ids })}/></td>
            <td><select aria-label="Counting basis" value={tier.quantity_basis} onChange={(event) => change({ quantity_basis: event.target.value as QuantityBasis })}>
              {Object.entries(QUANTITY_BASIS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></td>
            <td className="portal-row-actions">
              <label className="portal-check"><input type="checkbox" checked={tier.active} onChange={(event) => change({ active: event.target.checked })}/> Active</label>
              <button type="button" className="link danger" onClick={() => {
                if (!window.confirm(`Remove the ${tier.min_quantity.toLocaleString()} threshold? The change is staged until you save.`)) return;
                update((current) => ({ ...current, bulkTiers: current.bulkTiers.filter((_, i) => i !== index) }));
              }}>Remove</button>
            </td>
          </tr>;
        })}</tbody>
      </table>}
      <div className="portal-policy"><strong>How discounts work</strong><p>Only the highest qualifying discount applies. Discounts apply to printing and paper, not finishing or setup fees.</p></div>
    </div>
  </section>;
}

function SizePicker({ sizes, selected, onChange }: { sizes: SizeDraft[]; selected: string[]; onChange: (ids: string[]) => void }) {
  const label = selected.length === 0 ? "All sizes" : sizes.filter((size) => size.id && selected.includes(size.id)).map((size) => size.name).join(", ") || "All sizes";
  return <details className="size-picker">
    <summary>{label}</summary>
    <div>
      <label><input type="checkbox" checked={selected.length === 0} onChange={() => onChange([])}/> All sizes</label>
      {sizes.filter((size) => size.id).map((size) => <label key={size.id}>
        <input type="checkbox" checked={selected.includes(size.id!)} onChange={(event) => onChange(event.target.checked ? [...selected, size.id!] : selected.filter((id) => id !== size.id))}/>
        {size.name}
      </label>)}
    </div>
  </details>;
}

/** Owner-facing check that uses the same calculation as the public form. */
function QuotePreview({ draft, sizeId }: { draft: PricingDraftState; sizeId: string }) {
  const [quantity, setQuantity] = useState(100);
  const [pages, setPages] = useState(1);
  const [sides, setSides] = useState<1 | 2>(1);
  const [paperId, setPaperId] = useState("");
  const [finishingIds, setFinishingIds] = useState<string[]>([]);

  const catalog = useMemo(() => draftToCatalog(draft), [draft]);
  const size = catalog.products[0]?.sizes.find((item) => item.id === sizeId);
  const paper = size?.papers.find((item) => item.materialId === paperId) ?? size?.papers[0];
  const available = catalog.finishing.filter((option) => option.sizeIds.length === 0 || option.sizeIds.includes(sizeId));

  const result = size && paper ? priceJob({
    clientId: "preview", fileName: "preview.pdf", fileSize: 1, mimeType: "application/pdf", pageCount: pages,
    productId: catalog.products[0].id, sizeId, materialId: paper.materialId, quantity, sides,
    colorMode: "color", orientation: "portrait", finishingIds,
  }, catalog) : null;

  return <div className="portal-card preview-card">
    <h2 className="portal-subhead">Test a quote</h2>
    <p className="portal-note">Uses your unsaved values and the same calculation the customer form runs.</p>
    <div className="preview-fields">
      <label>Quantity<input type="number" min={1} value={quantity} onChange={(event) => setQuantity(Math.max(1, Number(event.target.value) || 1))}/></label>
      <label>Pages per file<input type="number" min={1} value={pages} onChange={(event) => setPages(Math.max(1, Number(event.target.value) || 1))}/></label>
      <label>Sides<select value={sides} onChange={(event) => setSides(Number(event.target.value) === 2 ? 2 : 1)}><option value={1}>Single-sided</option><option value={2}>Double-sided</option></select></label>
      <label>Paper<select value={paper?.materialId ?? ""} onChange={(event) => setPaperId(event.target.value)}>{size?.papers.map((item) => <option key={item.materialId} value={item.materialId}>{item.name}</option>)}</select></label>
    </div>
    {available.length > 0 && <div className="preview-finishing">{available.map((option) => <label key={option.id}>
      <input type="checkbox" checked={finishingIds.includes(option.id)} onChange={(event) => setFinishingIds(event.target.checked ? [...finishingIds, option.id] : finishingIds.filter((id) => id !== option.id))}/>
      {option.name}
    </label>)}</div>}
    {result?.status === "priced" ? <div className="preview-result">
      <ul>{result.lines.map((line) => <li key={line.label}><span>{line.label}</span><b>{line.amount.startsWith("-") ? `−$${line.amount.slice(1)}` : `$${line.amount}`}</b></li>)}</ul>
      <p><span>Customer sees</span><strong>${result.subtotal}</strong></p>
    </div> : <div className="preview-result manual"><p><span>Customer sees</span><strong>Manual quote</strong></p><small>{result?.reason ?? "Select a size and paper."}</small></div>}
  </div>;
}
