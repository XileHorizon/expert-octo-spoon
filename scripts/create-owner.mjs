#!/usr/bin/env node
/**
 * Creates or updates an owner account.
 *
 *   npm run create-owner -- owner@example.com
 *
 * The password is read from stdin (hidden) and never appears in shell history,
 * arguments, or logs. Requires MYSQL_URL in the environment or .env.local.
 */

import { createInterface } from "node:readline";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";

const MIN_PASSWORD_LENGTH = 12;

for (const file of [".env.local", ".env"]) {
  const full = path.join(process.cwd(), file);
  if (!existsSync(full)) continue;
  for (const line of readFileSync(full, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

function askHidden(prompt) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const onData = (char) => {
      if (["\n", "\r", "\u0004"].includes(String(char))) process.stdin.removeListener("data", onData);
      else process.stdout.write("\u001b[2K\u001b[200D" + prompt + "*".repeat(rl.line.length));
    };
    process.stdout.write(prompt);
    process.stdin.on("data", onData);
    rl.question("", (value) => { rl.close(); process.stdout.write("\n"); resolve(value); });
  });
}

function passwordProblem(password) {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password)) return "Use both uppercase and lowercase letters.";
  if (!/[0-9]/.test(password)) return "Include at least one number.";
  return null;
}

const email = process.argv[2];
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail("Usage: npm run create-owner -- owner@example.com");
if (!process.env.MYSQL_URL) fail("MYSQL_URL is not set. Run npm run setup:local or add it to .env.local.");

const password = await askHidden(`Password for ${email}: `);
const confirm = await askHidden("Confirm password: ");
if (password !== confirm) fail("Passwords did not match.");
const problem = passwordProblem(password);
if (problem) fail(problem);

const pool = mysql.createPool({
  uri: process.env.MYSQL_URL,
  connectionLimit: 2,
  timezone: "Z",
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
});

try {
  const hash = await bcrypt.hash(password, 12);
  const [existing] = await pool.execute("select id from owners where email = ?", [email]);

  if (existing.length > 0) {
    await pool.execute("update owners set password_hash = ?, active = true where id = ?", [hash, existing[0].id]);
    await pool.execute("delete from owner_sessions where owner_id = ?", [existing[0].id]);
    console.log(`\nUpdated the password for ${email}. Existing sessions were signed out.\n`);
  } else {
    await pool.execute("insert into owners (email, password_hash, active) values (?,?,true)", [email, hash]);
    console.log(`\nCreated owner account ${email}. Sign in at /admin/login.\n`);
  }
} catch (error) {
  fail(`Could not save the owner account: ${error.message}`);
} finally {
  await pool.end();
}
