import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

export function loadLocalEnv() {
  for (const file of [".env.local", ".env"]) {
    const full = path.join(process.cwd(), file); if (!existsSync(full)) continue;
    for (const line of readFileSync(full, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
}

export function assertTestDatabaseUrl(url, productionUrl = process.env.MYSQL_URL) {
  const parsed = new URL(url);
  if (parsed.protocol !== "mysql:") throw new Error("Refusing destructive verification: MYSQL_TEST_URL must use the mysql: protocol.");
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!database.endsWith("_test")) throw new Error("Refusing destructive verification: MYSQL_TEST_URL database name must end in `_test`.");
  if (productionUrl) {
    const production = new URL(productionUrl);
    const sameServer = parsed.hostname.toLowerCase() === production.hostname.toLowerCase()
      && (parsed.port || "3306") === (production.port || "3306");
    const productionDatabase = decodeURIComponent(production.pathname.replace(/^\//, ""));
    if (sameServer && database === productionDatabase) {
      throw new Error("Refusing destructive verification: MYSQL_TEST_URL resolves to the configured MYSQL_URL database.");
    }
  }
  return { parsed, database };
}

export async function openTestDatabase({ reset = true, seed = true } = {}) {
  loadLocalEnv();
  const url = process.env.MYSQL_TEST_URL;
  if (!url) throw new Error("MYSQL_TEST_URL is not configured. On macOS run `npm run setup:local`; otherwise create a disposable MySQL 8 database whose name ends in `_test` and set MYSQL_TEST_URL.");
  assertTestDatabaseUrl(url);
  let db;
  try { db = await mysql.createConnection({ uri: url, multipleStatements: true, timezone: "Z" }); }
  catch (error) { throw new Error(`MySQL test prerequisite unavailable: ${error instanceof Error ? error.message : String(error)}. Start MySQL 8 and check MYSQL_TEST_URL.`); }
  const [[version]] = await db.query("select version() as version");
  if (!String(version.version).match(/^8\./)) { await db.end(); throw new Error(`MySQL 8 is required; test server reports ${version.version}.`); }
  if (reset) {
    await db.query("set foreign_key_checks=0");
    const [tables] = await db.query("select table_name from information_schema.tables where table_schema = database()");
    for (const row of tables) await db.query(`drop table if exists \`${String(row.TABLE_NAME ?? row.table_name).replaceAll("`", "``")}\``);
    await db.query("set foreign_key_checks=1");
    await db.query(readFileSync("db/schema.sql", "utf8"));
    await db.query(readFileSync("db/migrations/001-minimum-order-total.sql", "utf8"));
    await db.query(readFileSync("db/migrations/002-same-day-release.sql", "utf8"));
    await db.query(readFileSync("db/migrations/003-delivery-hardening.sql", "utf8"));
    if (seed) {
      await db.query(readFileSync("db/seed-required-catalog.sql", "utf8"));
      await db.query(readFileSync("db/seed-pricing-details.sql", "utf8"));
    }
  }
  return {
    async query(sql, params = []) {
      const [result] = await db.query(sql, params);
      if (Array.isArray(result)) return { rows: result, rowCount: result.length, affectedRows: 0 };
      return { rows: [], rowCount: result.affectedRows, affectedRows: result.affectedRows };
    },
    end: () => db.end(),
  };
}
