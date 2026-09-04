import { QuoteBuilder } from "@/components/quote-builder";
import { getServerCatalog } from "@/lib/catalog-server";
import { configuredMaxEmailBytes } from "@/lib/validation";

export const dynamic = "force-dynamic";

export default async function Home() {
  return <QuoteBuilder initialCatalog={await getServerCatalog()} maxEmailBytes={configuredMaxEmailBytes()}/>;
}
