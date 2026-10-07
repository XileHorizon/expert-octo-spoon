#!/usr/bin/env node
/** Daily cleanup plus durable password-reset delivery recovery. Safe to run repeatedly. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { databaseConnectionOptions } from "./database-config.mjs";
if (process.env.MAINTENANCE_SKIP_ENV_FILE !== "true") {
  for (const file of [".env.local", ".env"]) {
    const full = path.join(process.cwd(), file); if (!existsSync(full)) continue;
    for (const line of readFileSync(full, "utf8").split("\n")) { const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, ""); }
  }
}
const apply = process.argv.includes("--apply");
let databaseOptions;
try { databaseOptions = databaseConnectionOptions(process.env, { connectionLimit: 2 }); }
catch (error) { console.error(error instanceof Error ? error.message : "Database configuration is invalid."); process.exit(1); }
if (!databaseOptions) { console.error("Database credentials are not set. Configure MYSQL_URL or DB_HOST/DB_USER/DB_PASSWORD/DB_NAME."); process.exit(1); }
const pool = mysql.createPool(databaseOptions);
const log = (message) => console.log(`[${new Date().toISOString()}] ${message}`);
try {
  const [[sessions]] = await pool.query("select count(*) as n from owner_sessions where expires_at < utc_timestamp(3)");
  const [[resets]] = await pool.query("select count(*) as n from owner_password_resets where expires_at < utc_timestamp(3) or used_at is not null");
  const [[deliveries]] = await pool.query("select count(*) as n from owner_password_reset_deliveries where status in ('queued','processing')");
  log(`expired sessions: ${sessions.n}, expired/used reset tokens: ${resets.n}, pending reset deliveries: ${deliveries.n}`);
  if (apply) {
    await pool.query("delete from owner_sessions where expires_at < utc_timestamp(3)");
    await pool.query("delete from owner_password_resets where expires_at < utc_timestamp(3) or used_at is not null");
    await pool.query("delete from owner_password_reset_deliveries where status in ('delivered','failed') and updated_at < date_sub(utc_timestamp(3),interval 30 day)");
    const workerSecret = process.env.RESET_DELIVERY_WORKER_SECRET;
    const appUrl = process.env.APP_URL;
    if (workerSecret && appUrl) {
      const workerUrl = new URL("/api/internal/password-reset-deliveries", appUrl);
      const response = await fetch(workerUrl, { method: "POST", headers: { authorization: `Bearer ${workerSecret}` } });
      if (!response.ok) throw new Error(`reset delivery worker returned HTTP ${response.status}`);
      const result = await response.json();
      log(`reset delivery worker processed: ${Number(result.processed ?? 0)}`);
    } else if (Number(deliveries.n) > 0) {
      throw new Error("pending reset delivery recovery requires APP_URL and RESET_DELIVERY_WORKER_SECRET");
    }
    log("cleanup complete");
  } else log("dry run only; pass --apply to clean up");
} catch (error) { console.error(`maintenance failed: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; }
finally { await pool.end(); }
