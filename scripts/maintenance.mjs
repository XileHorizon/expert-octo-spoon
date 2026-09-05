#!/usr/bin/env node
/** Daily cleanup of expired sessions and reset tokens. Safe to run repeatedly. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
for (const file of [".env.local", ".env"]) {
  const full = path.join(process.cwd(), file); if (!existsSync(full)) continue;
  for (const line of readFileSync(full, "utf8").split("\n")) { const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, ""); }
}
const apply = process.argv.includes("--apply");
if (!process.env.MYSQL_URL) { console.error("MYSQL_URL is not set."); process.exit(1); }
const pool = mysql.createPool({ uri: process.env.MYSQL_URL, connectionLimit: 2, timezone: "Z", ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined });
const log = (message) => console.log(`[${new Date().toISOString()}] ${message}`);
try {
  const [[sessions]] = await pool.query("select count(*) as n from owner_sessions where expires_at < utc_timestamp(3)");
  const [[resets]] = await pool.query("select count(*) as n from owner_password_resets where expires_at < utc_timestamp(3) or used_at is not null");
  log(`expired sessions: ${sessions.n}, expired/used reset tokens: ${resets.n}`);
  if (apply) {
    await pool.query("delete from owner_sessions where expires_at < utc_timestamp(3)");
    await pool.query("delete from owner_password_resets where expires_at < utc_timestamp(3) or used_at is not null");
    log("cleanup complete");
  } else log("dry run only; pass --apply to clean up");
} catch (error) { console.error(`maintenance failed: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; }
finally { await pool.end(); }
