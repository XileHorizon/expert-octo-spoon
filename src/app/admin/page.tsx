import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { requireApprovedOwner } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Owner portal",
  robots: { index: false, follow: false, nocache: true },
};

export default async function AdminPage() {
  const auth = await requireApprovedOwner();

  if (!auth.ok) {
    if (auth.status === 503) {
      return <main className="admin-shell">
        <div className="admin-warning">
          <strong>Owner portal unavailable:</strong> the database is not configured in this environment.
          Set <code>MYSQL_URL</code>, apply the database schema, and create the first owner with the
          masked <code>/admin/setup</code> flow or <code>npm run create-owner</code> before signing in.
        </div>
      </main>;
    }
    redirect("/admin/login");
  }

  return <AdminShell email={auth.owner.email}/>;
}
