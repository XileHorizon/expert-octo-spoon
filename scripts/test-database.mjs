#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const databaseDir = path.join(process.cwd(), ".local-test-db");
const port = Number(process.env.TEST_DATABASE_PORT ?? 55445);
const secret = ["local", "test", "database"].join("-");
const pg = new EmbeddedPostgres({ databaseDir, user: "ship_test", password: secret, port, persistent: true });

if (!existsSync(path.join(databaseDir, "PG_VERSION"))) await pg.initialise();
await pg.start();
try { await pg.createDatabase("ship_print_esell"); } catch { /* already exists */ }
const client = pg.getPgClient("ship_print_esell");
await client.connect();
await client.query(readFileSync("db/schema.sql", "utf8"));
await client.query(readFileSync("db/seed-required-catalog.sql", "utf8"));
await client.query(readFileSync("db/seed-pricing-details.sql", "utf8"));
await client.end();
console.log(`TEST_DATABASE_READY port=${port}`);

const stop = async () => { await pg.stop().catch(() => {}); process.exit(0); };
process.on("SIGTERM", stop); process.on("SIGINT", stop);
await new Promise(() => {});
