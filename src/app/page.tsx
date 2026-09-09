import { QuoteBuilder } from "@/components/quote-builder";
import { getServerCatalog } from "@/lib/catalog-server";
import { configuredMaxEmailBytes } from "@/lib/validation";
import { isDatabaseConfigured, queryOne } from "@/lib/db";
import { defaultBusinessSettings } from "@/lib/admin-validation";

export const dynamic = "force-dynamic";

export default async function Home() {
  const settings = isDatabaseConfigured()
    ? await queryOne<{ contact_phone: string; contact_email: string }>("select contact_phone,contact_email from business_settings where id=1").catch(() => null)
    : null;
  return <QuoteBuilder
    initialCatalog={await getServerCatalog()}
    maxEmailBytes={configuredMaxEmailBytes()}
    contact={{ phone: settings?.contact_phone ?? defaultBusinessSettings.contact_phone, email: settings?.contact_email ?? defaultBusinessSettings.contact_email }}
  />;
}
