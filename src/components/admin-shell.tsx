"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AdminPricing } from "@/components/admin-pricing";
import { AdminRequests } from "@/components/admin-requests";
import { AdminSettings } from "@/components/admin-settings";

type Tab = "requests" | "catalog" | "settings";

export function AdminShell({ email }: { email: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("requests");
  const [signingOut, setSigningOut] = useState(false);
  const [pricingDirty, setPricingDirty] = useState(false);

  function switchTab(next: Tab) {
    if (tab === "catalog" && next !== "catalog" && pricingDirty && !window.confirm("You have unsaved pricing changes. Leave without saving?")) return;
    setTab(next);
  }

  async function signOut() {
    setSigningOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/admin/login");
    router.refresh();
  }

  return <main className={tab === "catalog" ? "admin-shell admin-pricing-mode" : "admin-shell"}>
    <header className="admin-head">
      <div>
        <span className="wordmark"><span>SHIP</span> PRINT <b>eSELL</b></span>
        <h1>Owner portal</h1>
        <p>Signed in as {email}. Changes are never auto-saved.</p>
      </div>
      <div className="admin-head-actions">
        <Link href="/" target="_blank" rel="noopener noreferrer">View public form ↗</Link>
        <button type="button" onClick={() => void signOut()} disabled={signingOut}>{signingOut ? "Signing out…" : "Sign out"}</button>
      </div>
    </header>

    <nav className="admin-tabs" aria-label="Owner sections">
      <button type="button" className={tab === "requests" ? "active" : ""} aria-current={tab === "requests"} onClick={() => switchTab("requests")}>Quote requests</button>
      <button type="button" className={tab === "catalog" ? "active" : ""} aria-current={tab === "catalog"} onClick={() => switchTab("catalog")}>Catalog & pricing</button>
      <button type="button" className={tab === "settings" ? "active" : ""} aria-current={tab === "settings"} onClick={() => switchTab("settings")}>Business settings</button>
    </nav>

    {tab === "requests" ? <AdminRequests/> : tab === "catalog" ? <AdminPricing onDirtyChange={setPricingDirty}/> : <AdminSettings/>}
  </main>;
}
