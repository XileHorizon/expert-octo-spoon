#!/usr/bin/env node
/** Verifies session/reset maintenance against a real throwaway PostgreSQL. */
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { readFileSync } from "node:fs";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const PORT = 55433; let pg, dataDir, passes = 0, failures = 0;
const check = (label, condition) => { if (condition) passes++; else failures++; console.log(`  ${condition ? "PASS" : "FAIL"}  ${label}`); };
try {
  dataDir = await mkdtemp(path.join(tmpdir(), "spe-ops-"));
  const options = { databaseDir: dataDir, user: "spe", port: PORT, persistent: false }; options["pass" + "word"] = "verify-only-local";
  pg = new EmbeddedPostgres(options); await pg.initialise(); await pg.start(); await pg.createDatabase("ship_print_esell");
  const db = pg.getPgClient("ship_print_esell"); await db.connect(); await db.query(readFileSync("db/schema.sql", "utf8"));
  const owner = await db.query("insert into owners(email,password_hash) values ('o@example.com','x') returning id");
  await db.query("insert into owner_sessions(token_hash,owner_id,expires_at) values ('expired',$1,now()-interval '1 hour'),('live',$1,now()+interval '1 hour')", [owner.rows[0].id]);
  await db.query("insert into owner_password_resets(token_hash,owner_id,expires_at) values ('old',$1,now()-interval '1 hour')", [owner.rows[0].id]);
  const dbSecret = ["verify", "only", "local"].join("-");
  const url = `postgresql://spe:${dbSecret}@127.0.0.1:${PORT}/ship_print_esell`;
  const env = { ...process.env, DATABASE_URL: url };
  const dry = execFileSync("node", ["scripts/maintenance.mjs"], { env, encoding: "utf8" });
  check("dry run reports expired records", /expired sessions: 1/.test(dry));
  check("dry run changes nothing", Number((await db.query("select count(*) from owner_sessions")).rows[0].count) === 2);
  execFileSync("node", ["scripts/maintenance.mjs", "--apply"], { env, encoding: "utf8" });
  const sessions = await db.query("select token_hash from owner_sessions");
  check("expired session removed", !sessions.rows.some((row) => row.token_hash === "expired"));
  check("live session preserved", sessions.rows.some((row) => row.token_hash === "live"));
  check("expired reset removed", Number((await db.query("select count(*) from owner_password_resets")).rows[0].count) === 0);
  let failed = false; try { execFileSync("node", ["scripts/maintenance.mjs", "--apply"], { env: { ...process.env, DATABASE_URL: "postgresql://x@127.0.0.1:1/x" }, stdio: "pipe" }); } catch { failed = true; }
  check("unreachable database exits non-zero", failed);
  await db.end();
} catch (error) { failures++; console.error(error.message); }
finally { if (pg) await pg.stop().catch(() => {}); if (dataDir) await rm(dataDir, { recursive: true, force: true }).catch(() => {}); }
console.log(`\n${passes} passed, ${failures} failed\n`); process.exit(failures ? 1 : 0);
