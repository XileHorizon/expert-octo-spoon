#!/usr/bin/env node
/** Checks and initializes the dedicated real MySQL 8 verification database. */
import { openTestDatabase } from "./mysql-test-helper.mjs";
try {
  const db = await openTestDatabase({ reset: true, seed: true });
  await db.end();
  console.log("MYSQL_TEST_DATABASE_READY");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
