#!/usr/bin/env node
/** Guided, credential-safe Homebrew MySQL setup for macOS development. */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import mysql from "mysql2/promise";

function command(name) { try { return execFileSync("which", [name], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; } }
function fail(message) { console.error(`\n${message}\n`); process.exit(1); }
function askHidden(prompt) {
  if (!process.stdin.isTTY) fail("A terminal is required for the masked MySQL administrator password prompt.");
  return new Promise((resolve) => {
    let value = "";
    process.stdout.write(prompt);
    process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding("utf8");
    const onData = (key) => {
      if (key === "\r" || key === "\n") { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off("data", onData); process.stdout.write("\n"); resolve(value); }
      else if (key === "\u0003") { process.stdin.setRawMode(false); process.exit(130); }
      else if (key === "\u007f") { if (value) value = value.slice(0, -1); }
      else value += key;
    };
    process.stdin.on("data", onData);
  });
}

if (process.platform !== "darwin") fail("setup:local currently guides Homebrew macOS. Install MySQL 8, create a database/user, set MYSQL_URL in .env.local, then run npm run db:init.");
if (!command("brew")) fail("Homebrew is required. Install it from https://brew.sh, then run: brew install mysql");
if (!command("mysql")) fail("MySQL is not installed. Run: brew install mysql\nThen start it once with: brew services start mysql");
const ping = spawnSync("mysqladmin", ["ping", "--silent"], { stdio: "ignore" });
if (ping.status !== 0) fail("MySQL is installed but not running. Run this one-time service step, then rerun setup:\n\n  brew services start mysql");

let root;
try { root = await mysql.createConnection({ host: "127.0.0.1", user: "root", database: "mysql" }); }
catch {
  const password = await askHidden("Local MySQL root password (masked): ");
  try { root = await mysql.createConnection({ host: "127.0.0.1", user: "root", password, database: "mysql" }); }
  catch (error) { fail(`Could not connect as local MySQL root: ${error instanceof Error ? error.message : String(error)}`); }
}

const database = "ship_print_esell";
const testDatabase = "ship_print_esell_test";
const user = "ship_print";
const appPassword = randomBytes(24).toString("base64url");
try {
  await root.query(`create database if not exists \`${database}\` character set utf8mb4 collate utf8mb4_0900_ai_ci`);
  await root.query(`create database if not exists \`${testDatabase}\` character set utf8mb4 collate utf8mb4_0900_ai_ci`);
  for (const host of ["localhost", "127.0.0.1"]) {
    await root.query(mysql.format("create user if not exists ?@? identified by ?", [user, host, appPassword]));
    await root.query(mysql.format("alter user ?@? identified by ?", [user, host, appPassword]));
    await root.query(mysql.format(`grant all privileges on \`${database}\`.* to ?@?`, [user, host]));
    await root.query(mysql.format(`grant all privileges on \`${testDatabase}\`.* to ?@?`, [user, host]));
  }
} finally { await root.end(); }

const envPath = ".env.local";
const current = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
const lines = current.split(/\r?\n/).filter((line) => !/^\s*(MYSQL_URL|MYSQL_TEST_URL|DATABASE_URL)\s*=/.test(line));
const url = `mysql://${user}:${appPassword}@127.0.0.1:3306/${database}`;
const testUrl = `mysql://${user}:${appPassword}@127.0.0.1:3306/${testDatabase}`;
writeFileSync(envPath, [`MYSQL_URL=${url}`, `MYSQL_TEST_URL=${testUrl}`, ...lines].join("\n").replace(/\n+$/, "\n"), { mode: 0o600 });
chmodSync(envPath, 0o600);
console.log("\nLocal MySQL database and .env.local are configured (credentials were not displayed). Initializing schema…\n");
const initialized = spawnSync(process.execPath, ["--env-file=.env.local", "scripts/init-db.mjs"], { stdio: "inherit" });
if (initialized.status !== 0) process.exit(initialized.status ?? 1);
console.log("Next: npm run create-owner -- owner@example.com\nThen: npm run dev:local");
