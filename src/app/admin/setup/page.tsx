import { OwnerSetupForm } from "@/components/owner-setup-form";
import { firstRunSetupAvailable } from "@/lib/first-run-bootstrap";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const configured = Boolean(process.env.FIRST_OWNER_SETUP_SECRET && process.env.FIRST_OWNER_SETUP_SECRET.length >= 32);
  const available = configured && await firstRunSetupAvailable().catch(() => false);
  return <main className="auth-shell"><OwnerSetupForm available={available}/></main>;
}
