#!/usr/bin/env node
/** Apply the rerunnable MySQL schema and required seeds using MYSQL_URL from .env.local. */
import { readFile } from "node:fs/promises";
import mysql from "mysql2/promise";

const mysqlUrl = process.env.MYSQL_URL;
if (!mysqlUrl) {
  console.error("\nMYSQL_URL is missing. Run npm run setup:local or configure .env.local first.\n");
  process.exit(1);
}

const files = ["db/schema.sql", "db/migrations/001-minimum-order-total.sql", "db/migrations/002-same-day-release.sql", "db/migrations/003-delivery-hardening.sql", "db/seed-required-catalog.sql", "db/seed-pricing-details.sql"];
let connection;
try {
  connection = await mysql.createConnection({ uri: mysqlUrl, multipleStatements: true, timezone: "Z", ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined });
  await connection.beginTransaction();
  for (const file of files) {
    console.log(`Applying ${file}`);
    await connection.query(await readFile(file, "utf8"));
  }
  await connection.commit();
  console.log("\nMySQL schema and required catalog are ready.\n");
} catch (error) {
  if (connection) await connection.rollback().catch(() => undefined);
  console.error(`\nDatabase initialization failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  if (connection) await connection.end();
}
