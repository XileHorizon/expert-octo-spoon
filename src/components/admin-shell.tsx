"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Image from "next/image";
import shipesel from "@/app/SVG/shipesel.svg";

import {
  AdminPricing,
  type PricingSection,
} from "@/components/admin-pricing";

import { AdminRequests } from "@/components/admin-requests";
import { AdminSettings } from "@/components/admin-settings";

type Tab = "requests" | "catalog" | "settings";

const PRICING_SECTIONS: {
  id: PricingSection;
  label: string;
  icon: string;
}[] = [
  { id: "papers", label: "Paper types", icon: "file" },
  { id: "sizes", label: "Sizes & pricing", icon: "tag" },
  { id: "options", label: "Print options & finishing", icon: "sliders" },
  { id: "discounts", label: "Bulk discounts", icon: "percent" },
];

const Icon = ({ name }: { name: string }) => {
  const paths: Record<string, React.ReactNode> = {
    file: (
      <>
        <path d="M8.75 1.25H3.75a1.25 1.25 0 0 0-1.25 1.25v10a1.25 1.25 0 0 0 1.25 1.25h7.5a1.25 1.25 0 0 0 1.25-1.25V5z" />
        <path d="M8.75 1.25V5h3.75" />
      </>
    ),
    tag: (
      <>
        <path d="m13.4 8.1-5.3 5.3a1.2 1.2 0 0 1-1.7 0L1.7 8.7V1.7h7l4.7 4.7a1.2 1.2 0 0 1 0 1.7z" />
        <circle cx="4.7" cy="4.7" r="0.9" />
      </>
    ),
    sliders: (
      <>
        <path d="M2.5 12.5v-4M2.5 5.5v-4M7.5 12.5v-6M7.5 3.5v-2M12.5 12.5v-3M12.5 6.5v-5M1 8.5h3M6 3.5h3M11 9.5h3" />
      </>
    ),
    percent: (
      <>
        <path d="M13 2 3 13" />
        <circle cx="4.2" cy="4.2" r="1.7" />
        <circle cx="11.8" cy="10.8" r="1.7" />
      </>
    ),
  };

  return (
    <svg
      viewBox="0 0 16 16"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
};

export function AdminShell({ email }: { email: string }) {
  const router = useRouter();

  const [tab, setTab] = useState<Tab>("requests");
  const [pricingSection, setPricingSection] =
    useState<PricingSection>("papers");

  const [signingOut, setSigningOut] = useState(false);
  const [pricingDirty, setPricingDirty] = useState(false);

  function switchTab(next: Tab) {
    if (
      tab === "catalog" &&
      next !== "catalog" &&
      pricingDirty &&
      !window.confirm(
        "You have unsaved pricing changes. Leave without saving?"
      )
    ) {
      return;
    }

    if (tab === "catalog" && next !== "catalog") {
      setPricingDirty(false);
    }

    setTab(next);
  }

  function switchPricingSection(next: PricingSection) {
    // If we're already in Catalog, AdminPricing stays mounted.
    // Only its visible section changes, so unsaved changes are preserved.
    setPricingSection(next);

    if (tab !== "catalog") {
      setTab("catalog");
    }
  }

  async function signOut() {
    if (
      tab === "catalog" &&
      pricingDirty &&
      !window.confirm(
        "You have unsaved pricing changes. Sign out without saving?"
      )
    ) {
      return;
    }

    setSigningOut(true);

    await fetch("/api/auth/logout", {
      method: "POST",
    });

    router.push("/admin/login");
    router.refresh();
  }

  return (
    <main
      className={
          "admin-shell admin-pricing-mode"      }
    >
      <div className="portal">
        <aside className="portal-sidebar">
          <div className="portal-brand">
           <Image className="brandmark" src={shipesel} alt="ShipPrinteSell" />
          </div>

          <nav aria-label="Owner portal navigation">
            <button
              type="button"
              className={tab === "requests" ? "active" : ""}
              aria-current={tab === "requests" ? "page" : undefined}
              onClick={() => switchTab("requests")}
            >
              <span>Quote requests</span>
            </button>
             <button
              type="button"
              className={tab === "settings" ? "active" : ""}
              aria-current={tab === "settings" ? "page" : undefined}
              onClick={() => switchTab("settings")}
            >
              <span>Business settings</span>
            </button>

            <p className="sidebar-label">Catalog & pricing</p>
            <div className="portal-subnav">
              {PRICING_SECTIONS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={
                    tab === "catalog" &&
                    pricingSection === item.id
                      ? "active"
                      : ""
                  }
                  aria-current={
                    tab === "catalog" &&
                    pricingSection === item.id
                      ? "page"
                      : undefined
                  }
                  onClick={() =>
                    switchPricingSection(item.id)
                  }
                >
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>

           
          </nav>

          <div className="portal-sidebar-bottom">
            <Link
              href="/"
              target="_blank"
              rel="noopener noreferrer"
            >
              View public form ↗
            </Link>

            <div className="portal-account">
              <small>Signed in as</small>
              <p>{email}</p>

              <button
                type="button"
                onClick={() => void signOut()}
                disabled={signingOut}
              >
                {signingOut ? "Signing out…" : "Sign out"}
              </button>
            </div>

            <div className="portal-help">
              <p>Need a hand?</p>
              <small>Call (614) 459-1205</small>
            </div>
          </div>
        </aside>

        <div className="portal-workspace">
          {tab === "requests" && <AdminRequests />}

          {tab === "catalog" && (
            <AdminPricing
              section={pricingSection}
              onDirtyChange={setPricingDirty}
            />
          )}

          {tab === "settings" && <AdminSettings />}
        </div>
      </div>
    </main>
  );
}