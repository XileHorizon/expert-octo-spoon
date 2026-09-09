"use client";

import { useCallback, useEffect, useState } from "react";
import { REQUEST_STATUS_LABELS, type RequestStatus } from "@/lib/types";

type Overview = {
  requests: { total: number; last24h: number; manualPricing: number; byStatus: Record<string, number>; needsAttention: number };
  catalog: { activeProducts: number; totalProducts: number; activeSizes: number; activeMaterials: number; activeFinishing: number; activeOptionsMissingRates: number };
};

type RequestRow = {
  id: string;
  customer_name: string;
  customer_email: string;
  organization: string | null;
  status: string;
  pricing_status: string;
  calculated_total: string | null;
  calculated_subtotal?: string | null;
  minimum_order_adjustment?: string | null;
  shop_delivery_status?: string | null;
  created_at: string;
};

type JobRow = {
  id: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  page_count: number | null;
  product_id: string;
  size_id: string;
  material_id: string;
  product_name: string | null;
  size_name: string | null;
  material_name: string | null;
  finishing_names: string[] | null;
  custom_width: string | null;
  custom_height: string | null;
  custom_units: string | null;
  color_mode: "color" | "black-white";
  orientation: "portrait" | "landscape";
  quantity: number;
  sides: number;
  finishing_ids: string[];
  notes: string | null;
  pricing_status: string;
  calculated_subtotal: string | null;
  pricing_reason: string | null;
};

type Detail = {
  request: RequestRow & { phone: string | null; updated_at: string };
  jobs: JobRow[];
  emails: { id: string; delivery_type: string; recipient: string | null; status: string; provider_message_id: string | null; error_message: string | null; created_at: string }[];
};

const STATUSES = Object.keys(REQUEST_STATUS_LABELS) as RequestStatus[];

const money = (value: string | null) => (value === null ? "Manual quote" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value)));
const when = (value: string) => new Date(value).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
const size = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.ceil(bytes / 1024))} KB`);
const deliveryLabel = (status: string) => status === "provider_accepted"
  ? "Provider accepted (inbox not confirmed)"
  : status === "queued"
    ? "Pending / reconciliation required"
    : status.replaceAll("_", " ");

export function artworkHandoffMessage(status?: string | null) {
  if (status === "provider_accepted") return "Original files were accepted by the mail provider with the shop notification and are not retained by this portal. Inbox placement is not confirmed.";
  if (status === "failed" || status === "not_configured") return "The shop file email was not accepted. This portal does not retain a downloadable production copy; contact the customer before proceeding.";
  if (status === "queued") return "The shop email outcome requires reconciliation. Do not assume the provider accepted the files until the delivery audit is resolved.";
  return "No shop file-handoff audit is available. Confirm receipt with the customer before proceeding.";
}

export function AdminRequests() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    const params = new URLSearchParams({ status, limit: "50" });
    if (search.trim()) params.set("search", search.trim());
    try {
      const [overviewResponse, listResponse] = await Promise.all([fetch("/api/admin/overview", { signal }), fetch(`/api/admin/requests?${params}`, { signal })]);
      const overviewData = await overviewResponse.json();
      const listData = await listResponse.json();
      if (overviewResponse.ok) setOverview(overviewData); else setMessage(overviewData.error ?? "Could not load the dashboard.");
      if (listResponse.ok) { setRows(listData.requests); setTotal(listData.total); } else setMessage(listData.error ?? "Could not load requests.");
    } catch (error) {
      if ((error as Error)?.name !== "AbortError") setMessage("Could not reach the owner API.");
      return;
    } finally {
      setLoading(false);
    }
  }, [status, search]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => { void load(controller.signal); }, 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [load]);

  async function openDetail(id: string) {
    setDetailBusy(true); setMessage("");
    const response = await fetch(`/api/admin/requests/${id}`);
    const data = await response.json();
    if (response.ok) setDetail(data); else setMessage(data.error ?? "Could not open the request.");
    setDetailBusy(false);
  }

  async function updateStatus(id: string, next: string) {
    setMessage("Saving status…");
    const response = await fetch(`/api/admin/requests/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: next }) });
    const data = await response.json();
    if (!response.ok) return setMessage(data.error ?? "Status update failed.");
    setMessage("Status saved.");
    setRows((current) => current.map((row) => (row.id === id ? { ...row, status: next } : row)));
    setDetail((current) => (current && current.request.id === id ? { ...current, request: { ...current.request, status: next } } : current));
    void load();
  }

  if (loading && !overview) return <p className="admin-loading">Loading owner dashboard…</p>;

  const shopDelivery = detail?.emails.find((email) => email.delivery_type === "shop_notification");
  const artworkHandoff = artworkHandoffMessage(shopDelivery?.status);

  return <div className="admin-panel">
    {message && <div className="admin-message" role="status">{message}</div>}

    {overview && <section className="metric-grid">
      <article><span>Needs attention</span><strong>{overview.requests.needsAttention}</strong><small>new requests or email failures</small></article>
      <article><span>Last 24 hours</span><strong>{overview.requests.last24h}</strong><small>new requests</small></article>
      <article><span>Manual pricing</span><strong>{overview.requests.manualPricing}</strong><small>need a quoted rate</small></article>
      <article><span>All requests</span><strong>{overview.requests.total}</strong><small>lifetime</small></article>
      <article><span>Active products</span><strong>{overview.catalog.activeProducts}<b>/{overview.catalog.totalProducts}</b></strong><small>{overview.catalog.activeMaterials} materials · {overview.catalog.activeSizes} sizes</small></article>
      <article className={overview.catalog.activeOptionsMissingRates ? "warn" : ""}><span>Active options without rates</span><strong>{overview.catalog.activeOptionsMissingRates}</strong><small>these force manual quotes</small></article>
    </section>}

    <section className="request-toolbar">
      <label>Status
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="all">All statuses</option>
          {STATUSES.map((value) => <option key={value} value={value}>{REQUEST_STATUS_LABELS[value]}</option>)}
        </select>
      </label>
      <label>Search
        <input value={search} placeholder="Name, email, or organization" onChange={(event) => setSearch(event.target.value)}/>
      </label>
      <button type="button" onClick={() => void load()}>Refresh</button>
    </section>

    {rows.length === 0 ? <p className="empty">No quote requests match these filters.</p> : <div className="request-table" role="table">
      <div className="request-row head" role="row"><span>Received</span><span>Customer</span><span>Status</span><span>Pricing</span><span></span></div>
      {rows.map((row) => <div className="request-row" role="row" key={row.id}>
        <span>{when(row.created_at)}</span>
        <span><strong>{row.customer_name}</strong><small>{row.organization || row.customer_email}</small></span>
        <span><select value={row.status} onChange={(event) => void updateStatus(row.id, event.target.value)}>{STATUSES.map((value) => <option key={value} value={value}>{REQUEST_STATUS_LABELS[value]}</option>)}</select></span>
        <span>{row.pricing_status === "priced" ? money(row.calculated_total) : "Manual quote"}{row.shop_delivery_status !== "provider_accepted" && <small>{row.shop_delivery_status === "queued" ? "Email audit pending" : "Email handoff needs review"}</small>}</span>
        <span><button type="button" onClick={() => void openDetail(row.id)}>Open</button></span>
      </div>)}
      <p className="request-count">{rows.length} of {total} requests</p>
    </div>}

    {detailBusy && <p className="admin-loading">Opening request…</p>}

    {detail && <section className="request-detail">
      <header>
        <div><span className="step">REQUEST</span><h2>{detail.request.customer_name}</h2><p>{detail.request.id}</p></div>
        <button type="button" onClick={() => setDetail(null)}>Close</button>
      </header>

      <div className="detail-grid">
        <p><span>Email</span><strong>{detail.request.customer_email}</strong></p>
        <p><span>Phone</span><strong>{detail.request.phone || "Not provided"}</strong></p>
        <p><span>Organization</span><strong>{detail.request.organization || "Not provided"}</strong></p>
        <p><span>Received</span><strong>{when(detail.request.created_at)}</strong></p>
        <p><span>Estimated total</span><strong>{detail.request.pricing_status === "priced" ? money(detail.request.calculated_total) : "Manual quote"}</strong></p>
        {detail.request.minimum_order_adjustment && <>
          <p><span>Subtotal before minimum</span><strong>{money(detail.request.calculated_subtotal ?? null)}</strong></p>
          <p><span>Minimum order adjustment</span><strong>{money(detail.request.minimum_order_adjustment)}</strong></p>
        </>}
      </div>

      <h3>Files and production details</h3>
      {detail.jobs.map((job, index) => <article className="detail-job" key={job.id}>
        <header><strong>File {index + 1}: {job.file_name}</strong><span>{size(job.file_size)} · {job.mime_type} · {job.page_count ? `${job.page_count} pages` : "page count unavailable"}</span></header>
        <div className="detail-grid">
          <p><span>Product</span><strong>{job.product_name ?? job.product_id}</strong></p>
          <p><span>Size</span><strong>{job.size_name ?? job.size_id}{job.custom_width && job.custom_height ? ` — ${job.custom_width} × ${job.custom_height} ${job.custom_units}` : ""}</strong></p>
          <p><span>Material</span><strong>{job.material_name ?? job.material_id}</strong></p>
          <p><span>Quantity</span><strong>{job.quantity.toLocaleString("en-US")}</strong></p>
          <p><span>Printed sides</span><strong>{job.sides === 1 ? "Single-sided" : "Double-sided"}</strong></p>
          <p><span>Color</span><strong>{job.color_mode === "color" ? "Full Color (CMYK)" : "Black & White"}</strong></p>
          <p><span>Orientation</span><strong>{job.orientation === "portrait" ? "Portrait" : "Landscape"}</strong></p>
          <p><span>Finishing</span><strong>{job.finishing_names?.length ? job.finishing_names.join(", ") : job.finishing_ids.length ? job.finishing_ids.join(", ") : "None"}</strong></p>
          <p><span>Item pricing</span><strong>{job.pricing_status === "priced" ? money(job.calculated_subtotal) : "Manual quote"}</strong></p>
        </div>
        {job.notes && <p className="detail-notes"><span>Customer notes</span>{job.notes}</p>}
        {job.pricing_reason && <p className="detail-notes"><span>Pricing note</span>{job.pricing_reason}</p>}
        <p className="detail-notes"><span>Artwork handoff</span>{artworkHandoff}</p>
      </article>)}

      <h3>Notification handoff</h3>
      {detail.emails.length === 0 ? <p className="empty">No handoff attempts recorded.</p> : <ul className="delivery-list">
        {detail.emails.map((email) => <li key={email.id}><strong>{email.delivery_type === "customer_confirmation" ? "Customer confirmation" : "Shop notification"}: {deliveryLabel(email.status)}</strong> · {when(email.created_at)}{email.recipient ? ` · ${email.recipient}` : ""}{email.error_message ? ` · ${email.error_message}` : ""}</li>)}
      </ul>}
    </section>}
  </div>;
}
