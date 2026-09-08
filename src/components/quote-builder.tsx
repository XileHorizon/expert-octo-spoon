"use client";

import Image from "next/image";
import { PDFDocument } from "pdf-lib";
import { useMemo, useRef, useState } from "react";
import { minimumForSize, isBusinessCardSize } from "@/lib/catalog";
import { createClientUuid } from "@/lib/client-id";
import { priceQuote } from "@/lib/pricing";
import { patchItemById, toggleExpandedId } from "@/lib/quote-state";
import type { Catalog, QuoteJobInput } from "@/lib/types";
import { ALLOWED_MIME_TYPES, MAX_FILE_BYTES, MAX_FILES, MAX_TOTAL_BYTES, estimateEncodedEmailBytes, maxRawBytesForEmail } from "@/lib/validation";
import shipesel from "@/app/SVG/shipesel.svg";

type LocalJob = QuoteJobInput & { file: File };
type Customer = { name: string; email: string; organization: string; phone: string };

const asset = (name: string) => `/figma/${name}`;
const bytes = (value: number) => value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(value / 1024)} KB`;
const currency = (value: string) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value));

async function pageCount(file: File) {
  if (file.type !== "application/pdf") return null;
  try { return (await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: false })).getPageCount(); } catch { return null; }
}

function SectionHeader({ number, title, description }: { number: number; title: string; description: string }) {
  return <div className="quote-section-header"><div><span className="quote-step">{number}</span><h2>{title}</h2></div><p>{description}</p></div>;
}

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return <Image className="figma-icon" src={asset(name)} width={size} height={size} alt="" aria-hidden="true" unoptimized/>;
}

function FileConfiguration({ job, index, catalog, expanded, price, onToggle, onPatch, onRemove }: {
  job: LocalJob;
  index: number;
  catalog: Catalog;
  expanded: boolean;
  price: ReturnType<typeof import("@/lib/pricing").priceJob>;
  onToggle: () => void;
  onPatch: (patch: Partial<LocalJob>) => void;
  onRemove: () => void;
}) {
  const product = catalog.products.find((item) => item.id === job.productId)!;
  const size = product.sizes.find((item) => item.id === job.sizeId);
  const papers = (size?.papers ?? []).filter((item) => item.active);
  const selectedMaterial = papers.find((item) => item.materialId === job.materialId);
  const minimum = minimumForSize(size, product.minimumQuantity);
  const businessCards = isBusinessCardSize(size);
  const quickQuantities = businessCards ? [200, 250, 500, 1000] : [1, 10, 25, 50, 100, 250];

  function changeProduct(productId: string) {
    const next = catalog.products.find((item) => item.id === productId)!;
    const nextSize = next.sizes.find((item) => item.active);
    onPatch({ productId, sizeId: nextSize?.id ?? "", materialId: "", quantity: minimumForSize(nextSize, next.minimumQuantity), customWidth: undefined, customHeight: undefined, customUnits: undefined });
  }

  function changeSize(sizeId: string) {
    const nextSize = product.sizes.find((item) => item.id === sizeId);
    onPatch({ sizeId, materialId: "", quantity: Math.max(job.quantity, minimumForSize(nextSize, product.minimumQuantity)), customWidth: undefined, customHeight: undefined, customUnits: undefined });
  }

  const summary = [size?.name ?? "Choose size", `${job.quantity.toLocaleString("en-US")} qty`, selectedMaterial?.name ?? "Choose paper", price.status === "priced" && price.subtotal ? currency(price.subtotal) : "Manual quote"];

  return <article className={`file-config ${expanded ? "expanded" : ""}`} data-file-id={job.clientId}>
    <header className="file-config-head">
      <button className="file-config-toggle" type="button" onClick={onToggle} aria-expanded={expanded} aria-controls={`config-${job.clientId}`}>
        <span className={`file-icon ${job.mimeType === "application/pdf" ? "pdf" : "image"}`}><Icon name={job.mimeType === "application/pdf" ? "file-pdf.svg" : "image.svg"} size={20}/></span>
        <span className="uploaded-details"><strong>{index + 1}. {job.fileName}</strong><small>{bytes(job.fileSize)}{job.pageCount ? ` • ${job.pageCount} page${job.pageCount === 1 ? "" : "s"}` : ""}</small><span className="file-summary">{summary.join(" • ")}</span></span>
        <span className="file-chevron" aria-hidden="true">⌄</span>
      </button>
      <button className="trash-button" type="button" aria-label={`Remove ${job.fileName}`} onClick={onRemove}><Icon name="trash.svg" size={20}/></button>
    </header>

    {expanded && <div className="file-config-body" id={`config-${job.clientId}`}>
      <div className="file-subsection">
        <h3>Print size</h3>
        {catalog.products.filter((item) => item.active).length > 1 && <label className="quote-field full"><span>Print Product</span><select value={job.productId} onChange={(event) => changeProduct(event.target.value)}>{catalog.products.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
        <div className="chip-row size-chips">{product.sizes.filter((item) => item.active).map((option) => <button key={option.id} type="button" className={job.sizeId === option.id ? "selected" : ""} onClick={() => changeSize(option.id)}>{option.name}</button>)}</div>
        {size?.custom && <div className="custom-dimensions">
          <label className="quote-field"><span>Width</span><input inputMode="decimal" value={job.customWidth ?? ""} onChange={(event) => onPatch({ customWidth: event.target.value })}/></label>
          <label className="quote-field"><span>Height</span><input inputMode="decimal" value={job.customHeight ?? ""} onChange={(event) => onPatch({ customHeight: event.target.value })}/></label>
          <label className="quote-field"><span>Units</span><select value={job.customUnits ?? ""} onChange={(event) => onPatch({ customUnits: event.target.value as "in" | "cm" | "mm" })}><option value="" disabled>Choose</option><option value="in">Inches</option><option value="cm">Centimeters</option><option value="mm">Millimeters</option></select></label>
        </div>}
        {businessCards && <p className="business-card-note">Minimum order: 200. Inquire for premium business card options.</p>}
      </div>

      <div className="file-subsection">
        <h3>Quantity</h3>
        <div className="quantity-row"><div className="quantity-stepper"><button type="button" onClick={() => onPatch({ quantity: Math.max(minimum, job.quantity - 1) })}><Icon name="minus.svg" size={24}/></button><input aria-label={`Quantity for ${job.fileName}`} type="number" min={minimum} max="1000000" value={job.quantity} onChange={(event) => onPatch({ quantity: Number(event.target.value) })}/><button type="button" onClick={() => onPatch({ quantity: job.quantity + 1 })}><Icon name="plus.svg" size={24}/></button></div>
        <div className="chip-row quantity-chips">{quickQuantities.map((quantity) => <button key={quantity} type="button" disabled={quantity < minimum} className={job.quantity === quantity ? "selected" : ""} onClick={() => onPatch({ quantity })}>{quantity === 250 && !businessCards ? "250+" : quantity}</button>)}</div></div>
        <small className="minimum-copy">Minimum {minimum.toLocaleString("en-US")}</small>
      </div>

      <div className="file-subsection options-card">
        <h3>Print options</h3>
        <label className="quote-field full icon-select"><span>Paper & Material Stock</span><span className="select-shell"><Icon name="file.svg" size={18}/><select value={job.materialId} onChange={(event) => onPatch({ materialId: event.target.value })}><option value="" disabled>{papers.length ? "Select paper/material" : "Paper/material options to be confirmed"}</option>{papers.map((item) => <option key={item.materialId} value={item.materialId}>{[item.name, item.weight].filter(Boolean).join(" ")}</option>)}</select></span></label>
        {!job.materialId && <p className="selection-prompt">Choose a paper/material for this size. If options are unconfigured, select “Paper/material options to be confirmed” for a manual quote.</p>}
        <div className="three-options">
          <div><span className="field-label">Ink Colorway</span><div className="segmented"><button type="button" className={job.colorMode === "color" ? "active" : ""} onClick={() => onPatch({ colorMode: "color" })}>Full Color (CMYK)</button><button type="button" className={job.colorMode === "black-white" ? "active" : ""} onClick={() => onPatch({ colorMode: "black-white" })}>Black & White</button></div></div>
          <div><span className="field-label">Printed Sides</span><div className="segmented"><button type="button" className={job.sides === 1 ? "active" : ""} onClick={() => onPatch({ sides: 1 })}>Single Sided</button><button type="button" className={job.sides === 2 ? "active" : ""} onClick={() => onPatch({ sides: 2 })}>Double Sided</button></div></div>
          <div><span className="field-label">Orientation</span><div className="segmented"><button type="button" className={job.orientation === "portrait" ? "active" : ""} onClick={() => onPatch({ orientation: "portrait" })}>Portrait</button><button type="button" className={job.orientation === "landscape" ? "active" : ""} onClick={() => onPatch({ orientation: "landscape" })}>Landscape</button></div></div>
        </div>
        <div className="finishing"><span className="field-label">Select Finishing Touches</span><div className="finish-grid">{catalog.finishing.filter((item) => item.active).map((option) => { const checked = job.finishingIds.includes(option.id); return <label className={checked ? "checked" : ""} key={option.id}><input type="checkbox" checked={checked} onChange={() => onPatch({ finishingIds: checked ? job.finishingIds.filter((id) => id !== option.id) : [...job.finishingIds, option.id] })}/><span>{option.name}</span></label>; })}</div></div>
        <label className="quote-field full"><span>Additional instructions (optional)</span><textarea className="instructions" value={job.notes ?? ""} maxLength={2000} placeholder="Folding guides, packaging details, deadlines, or other notes for this file." onChange={(event) => onPatch({ notes: event.target.value })}/></label>
      </div>

      <div className={`file-estimate ${price.status}`}><span>{price.status === "priced" ? "Estimated price" : "Pricing"}</span><strong>{price.status === "priced" && price.subtotal ? currency(price.subtotal) : "Manual quote"}</strong>{price.reason && <small>{price.reason}</small>}</div>
    </div>}
  </article>;
}

export function QuoteBuilder({ initialCatalog, maxEmailBytes }: { initialCatalog: Catalog; maxEmailBytes: number }) {
  const [catalog] = useState(initialCatalog);
  const [jobs, setJobs] = useState<LocalJob[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [customer, setCustomer] = useState<Customer>({ name: "", email: "", organization: "", phone: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState<{ requestId: string; pricingStatus: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pricing = useMemo(() => priceQuote(jobs, catalog), [jobs, catalog]);
  const totalBytes = jobs.reduce((sum, job) => sum + job.fileSize, 0);
  const effectiveCombinedCap = Math.min(MAX_TOTAL_BYTES, maxRawBytesForEmail(maxEmailBytes, Math.max(jobs.length, 1)));

  async function addFiles(list: FileList | File[]) {
    setError(""); setSuccess(null);
    const incoming = Array.from(list);
    if (jobs.length + incoming.length > MAX_FILES) return setError(`You can submit up to ${MAX_FILES} files per request.`);
    const nextTotal = totalBytes + incoming.reduce((sum, file) => sum + file.size, 0);
    if (nextTotal > MAX_TOTAL_BYTES) return setError(`Adding those files would exceed the ${bytes(MAX_TOTAL_BYTES)} combined upload limit. Current files: ${bytes(totalBytes)}.`);
    const encoded = estimateEncodedEmailBytes(nextTotal, jobs.length + incoming.length);
    if (encoded > maxEmailBytes) return setError("Those files would exceed the email attachment limit after encoding. Reduce the submission size or contact the shop for another transfer method.");

    const product = catalog.products.find((item) => item.active);
    const size = product?.sizes.find((item) => item.active);
    if (!product || !size) return setError("No print sizes are available yet.");
    const accepted: LocalJob[] = [];
    for (const file of incoming) {
      if (!ALLOWED_MIME_TYPES.has(file.type) || file.size > MAX_FILE_BYTES) { setError("Only PDF, PNG, and JPEG files up to 25 MB each are accepted."); continue; }
      accepted.push({ file, clientId: createClientUuid(), fileName: file.name, fileSize: file.size, mimeType: file.type, pageCount: await pageCount(file), productId: product.id, sizeId: size.id, materialId: "", quantity: minimumForSize(size, product.minimumQuantity), sides: 1, colorMode: "color", orientation: "portrait", finishingIds: [], notes: "" });
    }
    if (accepted.length) {
      setJobs((current) => [...current, ...accepted]);
      setExpandedIds((current) => new Set([...current, accepted[0].clientId]));
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  function patchJob(id: string, patch: Partial<LocalJob>) { setJobs((current) => patchItemById(current, id, patch)); }
  function removeJob(id: string) { setJobs((current) => current.filter((item) => item.clientId !== id)); setExpandedIds((current) => { const next = new Set(current); next.delete(id); return next; }); }
  function toggleJob(id: string) { setExpandedIds((current) => toggleExpandedId(current, id)); }

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(""); setSuccess(null);
    if (!jobs.length) return setError("Add at least one file.");
    if (!customer.name.trim() || !customer.email.trim()) return setError("Name and email are required.");
    for (const job of jobs) {
      const product = catalog.products.find((item) => item.id === job.productId)!;
      const size = product.sizes.find((item) => item.id === job.sizeId);
      if (!job.materialId) { setExpandedIds((current) => new Set(current).add(job.clientId)); return setError(`Choose a paper/material for ${job.fileName}.`); }
      if (job.quantity < minimumForSize(size, product.minimumQuantity)) { setExpandedIds((current) => new Set(current).add(job.clientId)); return setError(`${job.fileName} is below its minimum quantity.`); }
      if (size?.custom && (!job.customWidth || !job.customHeight || !job.customUnits)) { setExpandedIds((current) => new Set(current).add(job.clientId)); return setError(`Enter custom width, height, and units for ${job.fileName}.`); }
    }

    setBusy(true);
    const idempotencyKey = createClientUuid();
    const payload = { idempotencyKey, customer, jobs: jobs.map(({ file: _file, ...job }) => { void _file; return job; }) };
    const form = new FormData(); form.set("payload", JSON.stringify(payload)); jobs.forEach((job) => form.append("files", job.file, job.file.name));
    try {
      const response = await fetch("/api/quote-requests", { method: "POST", body: form, headers: { "Idempotency-Key": idempotencyKey } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "The request could not be submitted.");
      setSuccess({ requestId: data.requestId, pricingStatus: data.pricingStatus }); setJobs([]); setExpandedIds(new Set());
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The request could not be submitted."); }
    finally { setBusy(false); }
  }

  const manualItems = jobs.filter((_, index) => pricing.items[index]?.status === "manual");

  return <main className="quote-page">
    <header className="quote-header"><Image className="brandmark" src={shipesel} alt="Ship Print eSell" priority unoptimized/><p>Need help? Call <a href="tel:6144591205">(614) 459-1205</a></p></header>
    <form className="quote-layout" onSubmit={submit}>
      <div className="quote-column">
        <div className="quote-intro"><h1>Custom Print Quote Builder</h1><p>Upload each file and configure its print specifications independently. We’ll review the complete request before confirming final pricing.</p></div>

        <section className="quote-card upload-card">
          <SectionHeader number={1} title="Upload Artwork & Configure Files" description="Each uploaded file has its own independently saved print configuration."/>
          {catalog.placeholderNotice && <div className="quote-notice" role="note"><strong>Setup notice:</strong> {catalog.placeholderNotice}</div>}
          <button className="quote-dropzone" type="button" onClick={() => inputRef.current?.click()} onDrop={(event) => { event.preventDefault(); void addFiles(event.dataTransfer.files); }} onDragOver={(event) => event.preventDefault()}>
            <span className="upload-icon-wrap"><Icon name="upload-cloud.svg" size={24}/></span><span><strong>Drag and drop your print files here</strong><small>or click to browse local folders</small></span><em>PDF, PNG, JPG • 25 MB each • {bytes(effectiveCombinedCap)} combined</em>
          </button>
          <input ref={inputRef} className="sr-only" type="file" multiple accept="application/pdf,image/png,image/jpeg" onChange={(event) => event.target.files && void addFiles(event.target.files)} />
          <div className="upload-meter"><span>Current combined file size</span><strong>{bytes(totalBytes)} / {bytes(effectiveCombinedCap)}</strong><progress value={totalBytes} max={effectiveCombinedCap}/></div>
          {jobs.length > 0 && <div className="file-config-list"><h3>Uploaded Files ({jobs.length})</h3>{jobs.map((job, index) => <FileConfiguration key={job.clientId} job={job} index={index} catalog={catalog} expanded={expandedIds.has(job.clientId)} price={pricing.items[index]} onToggle={() => toggleJob(job.clientId)} onPatch={(patch) => patchJob(job.clientId, patch)} onRemove={() => removeJob(job.clientId)}/>)}</div>}
        </section>

        <p className="fulfillment-disclaimer">Available options, turnaround times, and fulfillment arrangements vary by print type and will be confirmed when we review your request.</p>

        <section className="quote-card">
          <SectionHeader number={2} title="Your Information" description="Who should we send the finalized pricing proposal to?"/>
          <div className="customer-grid"><label className="quote-field"><span>Full Name *</span><input required autoComplete="name" value={customer.name} onChange={(event) => setCustomer({ ...customer, name: event.target.value })}/></label><label className="quote-field"><span>Company Name (Optional)</span><input autoComplete="organization" value={customer.organization} onChange={(event) => setCustomer({ ...customer, organization: event.target.value })}/></label><label className="quote-field"><span>Email Address *</span><input required type="email" autoComplete="email" value={customer.email} onChange={(event) => setCustomer({ ...customer, email: event.target.value })}/></label><label className="quote-field"><span>Phone Number</span><input type="tel" autoComplete="tel" value={customer.phone} onChange={(event) => setCustomer({ ...customer, phone: event.target.value })}/></label></div>
        </section>

        <section className="quote-card submit-card">
          {error && <div className="quote-error" role="alert">{error}</div>}{success && <div className="quote-success" role="status"><strong>Request received.</strong> Reference: {success.requestId}</div>}
          <button className="quote-submit" disabled={busy || jobs.length === 0}>{busy ? "Submitting…" : "Submit Official Quote Request"}</button>
          <p className="secure-copy"><Icon name="shield-check.svg" size={24}/> Your files and full request are handed directly to the print team by email.</p>
        </section>
      </div>

      <aside className="quote-summary">
        <div className="summary-head"><h2>Your Quote Summary</h2><span>{jobs.length === 0 ? "DRAFT" : pricing.status === "priced" ? "ESTIMATE" : "REVIEW"}</span></div>
        <div className="summary-file-list">{jobs.length === 0 ? <p className="empty-summary">Upload a file to begin.</p> : jobs.map((job, index) => { const product = catalog.products.find((item) => item.id === job.productId); const size = product?.sizes.find((item) => item.id === job.sizeId); const material = size?.papers.find((item) => item.materialId === job.materialId); const item = pricing.items[index]; return <article key={job.clientId}><strong>{index + 1}. {job.fileName}</strong><p>{size?.name ?? "Size not selected"}</p><p>{job.quantity.toLocaleString("en-US")} • {material ? [material.name, material.weight].filter(Boolean).join(" ") : "Paper not selected"}</p><b>{item?.status === "priced" && item.subtotal ? currency(item.subtotal) : "Awaiting quote"}</b></article>; })}</div>
        <div className="summary-price"><div><span>{jobs.length === 0 ? "Estimated Quote Total" : pricing.status === "manual" && Number(pricing.pricedSubtotal) > 0 ? "Priced items subtotal" : pricing.status === "priced" ? "Estimated Quote Total" : "Pricing"}</span><Icon name="info.svg" size={14}/></div>{jobs.length === 0 ? <p className="manual-total"><strong>—</strong></p> : pricing.status === "priced" ? <p><sup>$</sup><strong>{Number(pricing.total).toFixed(2)}</strong><b>USD</b></p> : Number(pricing.pricedSubtotal) > 0 ? <p><sup>$</sup><strong>{Number(pricing.pricedSubtotal).toFixed(2)}</strong><b>USD</b></p> : <p className="manual-total"><strong>Manual quote</strong></p>}{manualItems.length > 0 && <div className="manual-items"><strong>Awaiting a quote:</strong>{manualItems.map((job) => <span key={job.clientId}>{job.fileName}</span>)}</div>}<small>A partial subtotal is not a complete quote. Final pricing follows file review.</small></div>
        <div className="summary-help"><p><Icon name="phone.svg" size={14}/> Instant assistance: (614) 459-1205</p><p><Icon name="mail.svg" size={14}/> support@shipprintesell.com</p></div>
      </aside>
    </form>
  </main>;
}
