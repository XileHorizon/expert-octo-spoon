#!/usr/bin/env node
/**
 * Applies the additive schema and required catalog seeds.
 *
 * Run through `npm run db:init`; package.json loads .env.local before this
 * process starts, so DATABASE_URL never needs to be pasted into a command.
 */

import { readFile } from "node:fs/promises";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("\nDATABASE_URL is missing. Copy .env.example to .env.local and configure it first.\n");
  process.exit(1);
}

const files = [
  "db/schema.sql",
  "db/seed-required-catalog.sql",
  "db/seed-pricing-details.sql",
];

const pool = new pg.Pool({
  connectionString: databaseUrl,
  ssl: process.env.DATABASE_SSL === "true"
    ? { rejectUnauthorized: false }
    : undefined,
});

const client = await pool.connect().catch((error) => {
  console.error(`\nCould not connect to PostgreSQL: ${error.message}\n`);
  process.exit(1);
});

try {
  await client.query("begin");
  for (const file of files) {
    console.log(`Applying ${file}`);
    await client.query(await readFile(file, "utf8"));
  }
  await client.query("commit");
  console.log("\nDatabase schema and required catalog are ready.\n");
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  console.error(`\nDatabase initialization failed: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
