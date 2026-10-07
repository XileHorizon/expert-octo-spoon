#!/usr/bin/env node
/** Consistent MySQL metadata backup without putting credentials in argv or logs. */
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createGzip } from "node:zlib";
import { databaseCliIdentity } from "./database-config.mjs";

let identity;
try { identity = databaseCliIdentity(); }
catch (error) { console.error(error instanceof Error ? error.message : "Database configuration is invalid."); process.exit(1); }
if (!identity) { console.error("Database credentials are not set. Configure MYSQL_URL or DB_HOST/DB_USER/DB_PASSWORD/DB_NAME."); process.exit(1); }
const database = identity.database;
const backupDir = process.env.BACKUP_DIR ?? "/var/backups/ship-print-esell";
const retainDays = Number(process.env.BACKUP_RETAIN_DAYS ?? 30);
mkdirSync(backupDir, { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().slice(0, 10);
const target = path.join(backupDir, `db-${stamp}.sql.gz`);
const partial = `${target}.part`;
const temporary = mkdtempSync(path.join(tmpdir(), "ship-print-backup-"));
const defaults = path.join(temporary, "client.cnf");
writeFileSync(defaults, `[client]\nhost=${identity.host}\nport=${identity.port}\nuser=${identity.user}\npassword=${identity.password}\n`, { mode: 0o600 });
console.log(`[${new Date().toISOString()}] starting metadata backup`);
try {
  await new Promise((resolve, reject) => {
    const dump = spawn("mysqldump", [`--defaults-extra-file=${defaults}`, "--single-transaction", "--quick", "--routines", "--triggers", "--no-tablespaces", database], { stdio: ["ignore", "pipe", "inherit"] });
    const output = createWriteStream(partial, { mode: 0o600 });
    dump.stdout.pipe(createGzip()).pipe(output);
    dump.once("error", reject);
    dump.once("close", (code) => code === 0 ? undefined : reject(new Error(`mysqldump exited with status ${code}`)));
    output.once("error", reject);
    output.once("close", resolve);
  });
  if (statSync(partial).size < 1024) throw new Error("Backup is suspiciously small.");
  renameSync(partial, target); chmodSync(target, 0o600);
  const cutoff = Date.now() - retainDays * 86400000;
  for (const name of readdirSync(backupDir)) if (/^db-\d{4}-\d{2}-\d{2}\.sql\.gz$/.test(name)) {
    const file = path.join(backupDir, name); if (statSync(file).mtimeMs < cutoff) unlinkSync(file);
  }
  console.log(`[${new Date().toISOString()}] backup complete: ${target}`);
} catch (error) {
  if (existsSync(partial)) unlinkSync(partial);
  console.error(`Backup failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally { rmSync(temporary, { recursive: true, force: true }); }
