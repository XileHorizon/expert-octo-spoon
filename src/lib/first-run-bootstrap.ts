import { readFile } from "node:fs/promises";
import path from "node:path";
import mysql, { type Connection, type RowDataPacket } from "mysql2/promise";
import { firstOwnerSetupAvailable } from "./auth";
import { isDatabaseConfigured, queryRows } from "./db";

const INITIALIZATION_FILES = [
  "schema.sql",
  "migrations/001-minimum-order-total.sql",
  "migrations/002-same-day-release.sql",
  "migrations/003-delivery-hardening.sql",
  "seed-required-catalog.sql",
  "seed-pricing-details.sql",
] as const;

export const EXPECTED_APPLICATION_TABLES = [
  "admin_activity_log", "bulk_tier_sizes", "bulk_tiers", "business_settings", "email_deliveries",
  "finishing_options", "finishing_sizes", "fulfillment_options", "material_sizes", "materials",
  "owner_password_reset_deliveries", "owner_password_resets", "owner_sessions", "owner_setup_state",
  "owners", "products", "quote_jobs", "quote_requests", "size_papers", "sizes",
] as const;

export type FirstRunDatabaseState = "empty" | "ready" | "unsafe";

export function classifyFirstRunTables(tableNames: string[]): FirstRunDatabaseState {
  if (tableNames.length === 0) return "empty";
  const actual = new Set(tableNames);
  if (actual.size !== EXPECTED_APPLICATION_TABLES.length) return "unsafe";
  return EXPECTED_APPLICATION_TABLES.every((table) => actual.has(table)) ? "ready" : "unsafe";
}

type TableNameRow = RowDataPacket & { table_name: string };
type LockRow = RowDataPacket & { acquired: number };

async function tableNames(executor: Pick<Connection, "query">) {
  const [rows] = await executor.query<TableNameRow[]>(
    "select table_name from information_schema.tables where table_schema=database() and table_type='BASE TABLE' order by table_name",
  );
  return rows.map((row) => String(row.table_name));
}

async function currentState() {
  const rows = await queryRows<{ table_name: string }>(
    "select table_name from information_schema.tables where table_schema=database() and table_type='BASE TABLE' order by table_name",
  );
  return classifyFirstRunTables(rows.map((row) => String(row.table_name)));
}

/** Reports whether the setup page can safely create the first owner. */
export async function firstRunSetupAvailable() {
  if (!isDatabaseConfigured()) return false;
  const state = await currentState();
  if (state === "empty") return true;
  if (state === "unsafe") return false;
  return firstOwnerSetupAvailable();
}

export class UnsafeFirstRunDatabaseError extends Error {
  constructor() {
    super("Database initialization requires an empty database or a complete recognized application schema.");
    this.name = "UnsafeFirstRunDatabaseError";
  }
}

/**
 * Initializes only a completely empty database. Existing complete installations
 * are left untouched; unknown or partial databases are refused. The caller must
 * authenticate FIRST_OWNER_SETUP_SECRET before invoking this function.
 */
export async function prepareFirstRunDatabase() {
  const mysqlUrl = process.env.MYSQL_URL;
  if (!mysqlUrl) throw new Error("MYSQL_URL is not configured.");
  const connection = await mysql.createConnection({
    uri: mysqlUrl,
    multipleStatements: true,
    timezone: "Z",
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  });
  let locked = false;
  try {
    const [[lock]] = await connection.query<LockRow[]>("select get_lock('ship-print-esell:first-owner-bootstrap', 15) as acquired");
    locked = Number(lock?.acquired) === 1;
    if (!locked) throw new Error("Database setup is already in progress.");

    const state = classifyFirstRunTables(await tableNames(connection));
    if (state === "unsafe") throw new UnsafeFirstRunDatabaseError();
    if (state === "ready") return { initialized: false as const };

    for (const file of INITIALIZATION_FILES) {
      await connection.query(await readFile(path.join(process.cwd(), "db", file), "utf8"));
    }
    if (classifyFirstRunTables(await tableNames(connection)) !== "ready") {
      throw new Error("Database initialization did not produce the complete application schema.");
    }
    return { initialized: true as const };
  } finally {
    if (locked) await connection.query("select release_lock('ship-print-esell:first-owner-bootstrap')").catch(() => undefined);
    await connection.end();
  }
}
