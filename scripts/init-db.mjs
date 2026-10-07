#!/usr/bin/env node
/** Apply the rerunnable MySQL schema, migrations, and required catalog seeds. */
import { readFile } from "node:fs/promises";
import mysql from "mysql2/promise";
import { databaseConnectionOptions } from "./database-config.mjs";

const files = ["db/schema.sql", "db/migrations/001-minimum-order-total.sql", "db/migrations/002-same-day-release.sql", "db/migrations/003-delivery-hardening.sql", "db/migrations/004-finishing-content.sql", "db/migrations/005-auditable-unit-rates.sql", "db/seed-required-catalog.sql", "db/seed-pricing-details.sql"];
let connection;
try {
  const config = databaseConnectionOptions(process.env, { multipleStatements: true });
  if (!config) throw new Error("Database credentials are missing. Set MYSQL_URL or the complete DB_HOST/DB_USER/DB_PASSWORD/DB_NAME set.");
  connection = await mysql.createConnection(config);
  for (const file of files) {
    console.log(`Applying ${file}`);
    await connection.query(await readFile(file, "utf8"));
  }
  console.log("\nMySQL schema, migrations, and required catalog are ready.\n");
} catch (error) {
  console.error(`\nDatabase initialization failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  if (connection) await connection.end();
}
