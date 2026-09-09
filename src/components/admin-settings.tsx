"use client";

import { useEffect, useState } from "react";
import type { BusinessSettings } from "@/lib/admin-validation";

const FIELDS: { key: keyof BusinessSettings; label: string; hint?: string; type?: string; multiline?: boolean }[] = [
  { key: "contact_phone", label: "Support phone", hint: "Shown on the public quote summary." },
  { key: "contact_email", label: "Support email", type: "email", hint: "Shown on the public quote summary." },
  { key: "notification_target", label: "Quote notification recipient", type: "email", hint: "Leave blank to keep using the server-configured recipient." },
  { key: "minimum_order_total", label: "Minimum order total", type: "number", hint: "Automatically priced quotes below this amount receive a visible adjustment. Enter 0 to disable; manual quotes are never adjusted." },
  { key: "standard_turnaround", label: "Standard turnaround label" },
  { key: "rush_turnaround", label: "Rush turnaround label" },
  { key: "support_copy", label: "Support heading" },
  { key: "turnaround_intro", label: "Turnaround statement", multiline: true, hint: "Only publish commitments the shop can meet." },
];

export function AdminSettings() {
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/admin/settings")
      .then(async (response) => ({ ok: response.ok, data: await response.json() }))
      .then(({ ok, data }) => {
        if (!active) return;
        if (ok) setSettings(data.settings);
        else setMessage(data.error ?? "Business settings could not be loaded.");
        setLoading(false);
      });
    return () => { active = false; };
  }, []);

  async function save() {
    if (!settings) return;
    setBusy(true); setMessage("Saving business settings…");
    const payload = {
      contact_phone: settings.contact_phone,
      contact_email: settings.contact_email,
      turnaround_intro: settings.turnaround_intro,
      standard_turnaround: settings.standard_turnaround,
      rush_turnaround: settings.rush_turnaround,
      support_copy: settings.support_copy,
      notification_target: settings.notification_target?.trim() ? settings.notification_target.trim() : null,
      minimum_order_total: settings.minimum_order_total,
      color_adjustment: settings.color_adjustment,
      black_white_adjustment: settings.black_white_adjustment,
      portrait_adjustment: settings.portrait_adjustment,
      landscape_adjustment: settings.landscape_adjustment,
    };
    const response = await fetch("/api/admin/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json();
    if (response.ok) { setSettings(data.settings); setMessage("Business settings saved."); }
    else setMessage(data.error ?? "Save failed.");
    setBusy(false);
  }

  if (loading) return <p className="admin-loading">Loading business settings…</p>;
  if (!settings) return <div className="admin-panel">{message && <div className="admin-message" role="status">{message}</div>}</div>;

  return <div className="admin-panel">
    {message && <div className="admin-message" role="status">{message}</div>}
    <div className="admin-warning"><strong>Customer-facing copy:</strong> these values appear on the public quote form. Publish only commitments and contact details the shop has approved.</div>
    <section className="settings-form">
      {FIELDS.map((field) => <label key={field.key} className={field.multiline ? "wide" : ""}>
        {field.label}
        {field.multiline
          ? <textarea rows={3} value={String(settings[field.key] ?? "")} onChange={(event) => setSettings({ ...settings, [field.key]: event.target.value })}/>
          : <input type={field.type ?? "text"} min={field.key === "minimum_order_total" ? "0" : undefined} step={field.key === "minimum_order_total" ? "0.01" : undefined} value={String(settings[field.key] ?? "")} onChange={(event) => setSettings({ ...settings, [field.key]: event.target.value })}/>}
        {field.hint && <small>{field.hint}</small>}
      </label>)}
      <button type="button" className="save" onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : "Save business settings"}</button>
    </section>
  </div>;
}
