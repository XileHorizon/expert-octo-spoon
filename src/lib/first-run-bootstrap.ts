import { readFile } from "node:fs/promises";
import path from "node:path";
import mysql, { type Connection, type RowDataPacket } from "mysql2/promise";
import { firstOwnerSetupAvailable } from "./auth";
import { databaseConnectionOptions } from "./database-config";
import { getPool, isDatabaseConfigured } from "./db";

const INITIALIZATION_FILES = [
  "schema.sql",
  "migrations/001-minimum-order-total.sql",
  "migrations/002-same-day-release.sql",
  "migrations/003-delivery-hardening.sql",
  "migrations/004-finishing-content.sql",
  "migrations/005-auditable-unit-rates.sql",
  "seed-required-catalog.sql",
  "seed-pricing-details.sql",
] as const;

export const EXPECTED_APPLICATION_TABLES = [
  "admin_activity_log", "bulk_tier_sizes", "bulk_tiers", "business_settings", "email_deliveries",
  "finishing_option_images", "finishing_options", "finishing_sizes", "fulfillment_options", "material_sizes", "materials",
  "owner_password_reset_deliveries", "owner_password_resets", "owner_sessions", "owner_setup_state",
  "owners", "products", "quote_jobs", "quote_requests", "schema_migrations", "size_papers", "sizes",
] as const;

const REQUIRED_SCHEMA_COLUMNS = [
  "owners.email", "owners.password_hash", "owners.active",
  "owner_setup_state.completed_at", "owner_setup_state.owner_id",
  "owner_sessions.token_hash", "owner_sessions.expires_at",
  "owner_password_resets.used_at", "owner_password_reset_deliveries.status",
  "business_settings.minimum_order_total", "business_settings.color_adjustment",
  "business_settings.black_white_adjustment", "business_settings.portrait_adjustment",
  "business_settings.landscape_adjustment", "quote_requests.calculated_subtotal",
  "quote_requests.minimum_order_adjustment", "quote_jobs.color_adjustment",
  "quote_jobs.orientation_adjustment", "email_deliveries.delivery_type",
  "email_deliveries.recipient", "email_deliveries.attempt_sequence",
  "finishing_options.information_text", "finishing_options.image_alt",
  "finishing_option_images.content_hash", "finishing_option_images.image_data",
  "sizes.max_auto_quote_quantity", "sizes.manual_quote_message",
  "bulk_tiers.material_id", "bulk_tiers.color_mode", "bulk_tiers.sides",
] as const;

export type FirstRunDatabaseState = "empty" | "ready" | "unsafe";

export function classifyFirstRunTables(tableNames: string[]): FirstRunDatabaseState {
  if (tableNames.length === 0) return "empty";
  const actual = new Set(tableNames);
  if (actual.size !== EXPECTED_APPLICATION_TABLES.length) return "unsafe";
  return EXPECTED_APPLICATION_TABLES.every((table) => actual.has(table)) ? "ready" : "unsafe";
}

type TableNameRow = RowDataPacket & { table_name?: string; TABLE_NAME?: string };
type LockRow = RowDataPacket & { acquired: number };
type ColumnRow = RowDataPacket & { table_name?: string; TABLE_NAME?: string; column_name?: string; COLUMN_NAME?: string };
type SeedStateRow = RowDataPacket & {
  setup_rows: number; settings_rows: number; products: number; sizes: number;
  materials: number; mappings: number; paper_mappings: number; rates: number;
};
type CompletionSafetyRow = RowDataPacket & {
  owners: number; quotes: number; activity: number; setup_open: number;
};

async function tableNames(executor: Pick<Connection, "query">) {
  const [rows] = await executor.query<TableNameRow[]>(
    "select table_name from information_schema.tables where table_schema=database() and table_type='BASE TABLE' order by table_name",
  );
  return rows.map((row) => String(row.table_name ?? row.TABLE_NAME));
}

async function readyDatabaseSchemaIsConsistent(executor: Pick<Connection, "query">) {
  const [columns] = await executor.query<ColumnRow[]>(
    "select table_name,column_name from information_schema.columns where table_schema=database()",
  );
  const actualColumns = new Set(columns.map((row) =>
    `${String(row.table_name ?? row.TABLE_NAME)}.${String(row.column_name ?? row.COLUMN_NAME)}`,
  ));
  return REQUIRED_SCHEMA_COLUMNS.every((column) => actualColumns.has(column));
}

async function readyDatabaseSeedsPresent(executor: Pick<Connection, "query">) {
  const [[seedState]] = await executor.query<SeedStateRow[]>(`
    select
      (select count(*) from owner_setup_state where id=1) as setup_rows,
      (select count(*) from business_settings where id=1) as settings_rows,
      (select count(*) from products where id='10000000-0000-4000-8000-000000000001') as products,
      (select count(*) from sizes where id between '20000000-0000-4000-8000-000000000001' and '20000000-0000-4000-8000-000000000009') as sizes,
      (select count(*) from materials where id between '30000000-0000-4000-8000-000000000001' and '30000000-0000-4000-8000-000000000013') as materials,
      (select count(*) from material_sizes ms join sizes s on s.id=ms.size_id join materials m on m.id=ms.material_id
        where s.product_id='10000000-0000-4000-8000-000000000001' and m.product_id=s.product_id) as mappings,
      (select count(*) from size_papers sp join sizes s on s.id=sp.size_id join materials m on m.id=sp.material_id
        where s.product_id='10000000-0000-4000-8000-000000000001' and m.product_id=s.product_id) as paper_mappings,
      (select count(*) from bulk_tiers where id between '40000000-0000-4000-8000-000000000001' and '40000000-0000-4000-8000-000000000019') as rates
  `);
  return Number(seedState?.setup_rows) === 1
    && Number(seedState?.settings_rows) === 1
    && Number(seedState?.products) === 1
    && Number(seedState?.sizes) === 9
    && Number(seedState?.materials) === 13
    && Number(seedState?.mappings) >= 14
    && Number(seedState?.paper_mappings) >= 14
    && Number(seedState?.rates) === 19;
}

async function readyDatabaseCanReceiveRequiredSeeds(executor: Pick<Connection, "query">) {
  const [[state]] = await executor.query<CompletionSafetyRow[]>(`
    select
      (select count(*) from owners) as owners,
      (select count(*) from quote_requests) as quotes,
      (select count(*) from admin_activity_log) as activity,
      (select count(*) from owner_setup_state where id=1 and completed_at is null and owner_id is null) as setup_open
  `);
  return Number(state?.owners) === 0
    && Number(state?.quotes) === 0
    && Number(state?.activity) === 0
    && Number(state?.setup_open) === 1;
}

async function currentState() {
  const pool = getPool();
  if (!pool) return "unsafe" as const;
  return classifyFirstRunTables(await tableNames(pool));
}

/** Reports whether the setup page can safely create the first owner. */
export async function firstRunSetupAvailable() {
  if (!isDatabaseConfigured()) return false;
  const state = await currentState();
  if (state === "empty") return true;
  if (state === "unsafe") return false;
  const pool = getPool();
  if (!pool || !await readyDatabaseSchemaIsConsistent(pool)) return false;
  if (!await readyDatabaseSeedsPresent(pool) && !await readyDatabaseCanReceiveRequiredSeeds(pool)) return false;
  return firstOwnerSetupAvailable();
}

export class UnsafeFirstRunDatabaseError extends Error {
  constructor() {
    super("Database initialization requires an empty database or a complete recognized application schema.");
    this.name = "UnsafeFirstRunDatabaseError";
  }
}

/**
 * Initializes a completely empty database. A recognized ownerless schema may
 * receive only missing required catalog seeds; initialized/customer-bearing,
 * unknown, or structurally partial databases are never changed. The caller must
 * authenticate FIRST_OWNER_SETUP_SECRET before invoking this function.
 */
export async function prepareFirstRunDatabase() {
  const config = databaseConnectionOptions(process.env, { multipleStatements: true });
  if (!config) throw new Error("Database credentials are not configured.");
  const connection = await mysql.createConnection(config);
  let locked = false;
  try {
    const [[lock]] = await connection.query<LockRow[]>("select get_lock('ship-print-esell:first-owner-bootstrap', 15) as acquired");
    locked = Number(lock?.acquired) === 1;
    if (!locked) throw new Error("Database setup is already in progress.");

    const state = classifyFirstRunTables(await tableNames(connection));
    if (state === "unsafe") throw new UnsafeFirstRunDatabaseError();
    if (state === "ready") {
      if (!await readyDatabaseSchemaIsConsistent(connection)) throw new UnsafeFirstRunDatabaseError();
      let completedRequiredSeeds = false;
      if (!await readyDatabaseSeedsPresent(connection)) {
        if (!await readyDatabaseCanReceiveRequiredSeeds(connection)) throw new UnsafeFirstRunDatabaseError();
        for (const file of INITIALIZATION_FILES.slice(-2)) {
          await connection.query(await readFile(path.join(process.cwd(), "db", file), "utf8"));
        }
        if (!await readyDatabaseSeedsPresent(connection)) throw new UnsafeFirstRunDatabaseError();
        completedRequiredSeeds = true;
      }
      return { initialized: completedRequiredSeeds };
    }

    for (const file of INITIALIZATION_FILES) {
      await connection.query(await readFile(path.join(process.cwd(), "db", file), "utf8"));
    }
    if (classifyFirstRunTables(await tableNames(connection)) !== "ready"
      || !await readyDatabaseSchemaIsConsistent(connection)
      || !await readyDatabaseSeedsPresent(connection)) {
      throw new Error("Database initialization did not produce the complete application schema.");
    }
    return { initialized: true as const };
  } finally {
    if (locked) await connection.query("select release_lock('ship-print-esell:first-owner-bootstrap')").catch(() => undefined);
    await connection.end();
  }
}
