#!/usr/bin/env node
/** Verifies maintenance against a dedicated real MySQL 8 test database. */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { openTestDatabase, loadLocalEnv } from "./mysql-test-helper.mjs";

let db, passes = 0, failures = 0;
const check = (label, condition) => { if (condition) passes++; else failures++; console.log(`  ${condition ? "PASS" : "FAIL"}  ${label}`); };
try {
  loadLocalEnv();
  db = await openTestDatabase({ reset: true, seed: false });
  const ownerId = randomUUID();
  await db.query("insert into owners(id,email,password_hash) values (?,'o@example.com','x')", [ownerId]);
  await db.query("insert into owner_sessions(token_hash,owner_id,expires_at) values (?,?,date_sub(utc_timestamp(3),interval 1 hour)),(?,?,date_add(utc_timestamp(3),interval 1 hour))", ["a".repeat(64), ownerId, "b".repeat(64), ownerId]);
  await db.query("insert into owner_password_resets(token_hash,owner_id,expires_at) values (?,?,date_sub(utc_timestamp(3),interval 1 hour))", ["c".repeat(64), ownerId]);
  const env = { ...process.env, MYSQL_URL: process.env.MYSQL_TEST_URL };
  const dry = execFileSync("node", ["scripts/maintenance.mjs"], { env, encoding: "utf8" });
  check("dry run reports expired records", /expired sessions: 1/.test(dry));
  check("dry run changes nothing", Number((await db.query("select count(*) as n from owner_sessions")).rows[0].n) === 2);
  execFileSync("node", ["scripts/maintenance.mjs", "--apply"], { env, encoding: "utf8" });
  const sessions = await db.query("select token_hash from owner_sessions");
  check("expired session removed", !sessions.rows.some((row) => row.token_hash === "a".repeat(64)));
  check("live session preserved", sessions.rows.some((row) => row.token_hash === "b".repeat(64)));
  check("expired reset removed", Number((await db.query("select count(*) as n from owner_password_resets")).rows[0].n) === 0);
  await db.query("insert into owner_password_reset_deliveries(id,owner_id,status) values (?,?, 'queued')", [randomUUID(), ownerId]);
  let missingRecoveryConfigFailed = false;
  try {
    execFileSync("node", ["scripts/maintenance.mjs", "--apply"], {
      env: { ...env, APP_URL: "", RESET_DELIVERY_WORKER_SECRET: "", MAINTENANCE_SKIP_ENV_FILE: "true" },
      stdio: "pipe",
    });
  } catch { missingRecoveryConfigFailed = true; }
  check("pending reset delivery is never silently dropped when recovery is unconfigured", missingRecoveryConfigFailed);
  check("failed recovery leaves the durable reset delivery queued", (await db.query("select status from owner_password_reset_deliveries")).rows[0]?.status === "queued");
  let failed = false;
  try { execFileSync("node", ["scripts/maintenance.mjs", "--apply"], { env: { ...process.env, MYSQL_URL: "mysql://x@127.0.0.1:1/x" }, stdio: "pipe" }); } catch { failed = true; }
  check("unreachable database exits non-zero", failed);
} catch (error) { failures++; console.error(error instanceof Error ? error.message : String(error)); }
finally { if (db) await db.end().catch(() => {}); }
console.log(`\n${passes} passed, ${failures} failed\n`); process.exit(failures ? 1 : 0);
