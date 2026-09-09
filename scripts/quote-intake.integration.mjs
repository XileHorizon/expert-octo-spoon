#!/usr/bin/env node
/** Focused quote-intake persistence/idempotency checks against disposable real MySQL 8. */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { assertTestDatabaseUrl, openTestDatabase } from "./mysql-test-helper.mjs";

let primary;
let contender;
let passed = 0;
let failed = 0;
const check = (label, condition, detail = "") => {
  if (condition) { passed += 1; console.log(`  PASS  ${label}`); }
  else { failed += 1; console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }
};

try {
  console.log("\nQuote intake MySQL integration");

  let sameDatabaseRefused = false;
  try {
    assertTestDatabaseUrl("mysql://test@127.0.0.1/shop_test", "mysql://production@127.0.0.1/shop_test");
  } catch (error) {
    sameDatabaseRefused = /MYSQL_URL database/.test(error instanceof Error ? error.message : String(error));
  }
  check("harness refuses a production/test database collision", sameDatabaseRefused);

  let unsafeNameRefused = false;
  try { assertTestDatabaseUrl("mysql://test@127.0.0.1/shop"); }
  catch (error) { unsafeNameRefused = /must end in `_test`/.test(error instanceof Error ? error.message : String(error)); }
  check("harness refuses a database without the _test suffix", unsafeNameRefused);

  primary = await openTestDatabase({ reset: true, seed: true });
  contender = await openTestDatabase({ reset: false, seed: false });
  check("disposable MySQL 8 database opens", true);

  const migration = readFileSync("db/migrations/001-minimum-order-total.sql", "utf8");
  const releaseMigration = readFileSync("db/migrations/002-same-day-release.sql", "utf8");
  const hardeningMigration = readFileSync("db/migrations/003-delivery-hardening.sql", "utf8");
  await primary.query(migration);
  await primary.query(migration);
  await primary.query(releaseMigration);
  await primary.query(releaseMigration);
  await primary.query(hardeningMigration);
  await primary.query(hardeningMigration);
  const columns = await primary.query(
    `select table_name,column_name,data_type,numeric_scale
       from information_schema.columns
      where table_schema=database()
        and ((table_name='business_settings' and column_name='minimum_order_total')
          or (table_name='quote_requests' and column_name in ('calculated_subtotal','minimum_order_adjustment')))`
  );
  check("minimum-order migration is rerunnable and creates all fixed-point columns",
    columns.rowCount === 3 && columns.rows.every((row) => (row.DATA_TYPE ?? row.data_type) === "decimal" && Number(row.NUMERIC_SCALE ?? row.numeric_scale) === 2),
    JSON.stringify(columns.rows));

  await primary.query("alter table quote_requests modify status enum('received','intake_failed','reviewing','quoted','closed','request_received','quote_sent','in_progress','awaiting_payment','fulfilled') not null");
  const legacy = ["received", "intake_failed", "reviewing", "quoted", "closed"];
  for (const status of legacy) {
    await primary.query("insert into quote_requests(id,idempotency_key,customer_name,customer_email,pricing_status,status) values (?,?, 'Legacy','legacy@example.test','manual',?)", [randomUUID(), randomUUID(), status]);
  }
  await primary.query(releaseMigration);
  const mapped = (await primary.query("select status,count(*) as n from quote_requests group by status")).rows;
  const mappedCounts = Object.fromEntries(mapped.map((row) => [row.status, Number(row.n)]));
  check("legacy workflow statuses map without dropping rows",
    Object.values(mappedCounts).reduce((sum, count) => sum + count, 0) === 5
      && mappedCounts.request_received === 2 && mappedCounts.in_progress === 1 && mappedCounts.quote_sent === 1 && mappedCounts.fulfilled === 1,
    JSON.stringify(mappedCounts));

  const legacyOrderingRequest = randomUUID();
  await primary.query("insert into quote_requests(id,idempotency_key,customer_name,customer_email,pricing_status,status) values (?,?, 'Ordering','ordering@example.test','manual','quote_sent')", [legacyOrderingRequest, randomUUID()]);
  await primary.query("alter table email_deliveries modify attempt_sequence bigint unsigned not null");
  await primary.query("alter table email_deliveries drop index email_deliveries_attempt_unique");
  await primary.query("alter table email_deliveries drop column attempt_sequence");
  await primary.query(
    `insert into email_deliveries(id,quote_request_id,delivery_type,recipient,status,created_at)
     values ('00000000-0000-4000-8000-000000000001',?,'shop_notification','shop@example.test','provider_accepted','2026-01-01 00:00:00.123'),
            ('00000000-0000-4000-8000-000000000002',?,'shop_notification','shop@example.test','failed','2026-01-01 00:00:00.123')`,
    [legacyOrderingRequest, legacyOrderingRequest],
  );
  await primary.query(hardeningMigration);
  await primary.query(hardeningMigration);
  const migratedAttempts = await primary.query("select id,attempt_sequence from email_deliveries where quote_request_id=? order by attempt_sequence", [legacyOrderingRequest]);
  check("hardening migration reruns and deterministically backfills same-millisecond legacy rows without loss",
    migratedAttempts.rows.length === 2
      && migratedAttempts.rows[0].id.endsWith("0001")
      && Number(migratedAttempts.rows[0].attempt_sequence) < Number(migratedAttempts.rows[1].attempt_sequence),
    JSON.stringify(migratedAttempts.rows));

  const acceptedThenFailed = randomUUID();
  const failedThenAccepted = randomUUID();
  await primary.query(
    `insert into quote_requests(id,idempotency_key,customer_name,customer_email,pricing_status,status)
     values (?,?, 'First','first-order@example.test','manual','quote_sent'),(?,?, 'Second','second-order@example.test','manual','quote_sent')`,
    [acceptedThenFailed, randomUUID(), failedThenAccepted, randomUUID()],
  );
  const fixedTime = "2026-01-02 03:04:05.678";
  await primary.query(
    `insert into email_deliveries(quote_request_id,delivery_type,recipient,status,created_at)
     values (?,'shop_notification','shop@example.test','provider_accepted',?),
            (?,'shop_notification','shop@example.test','failed',?),
            (?,'shop_notification','shop@example.test','failed',?),
            (?,'shop_notification','shop@example.test','provider_accepted',?)`,
    [acceptedThenFailed, fixedTime, acceptedThenFailed, fixedTime, failedThenAccepted, fixedTime, failedThenAccepted, fixedTime],
  );
  const latestStatus = async (requestId) => (await primary.query(
    "select status from email_deliveries where quote_request_id=? and delivery_type='shop_notification' order by attempt_sequence desc limit 1",
    [requestId],
  )).rows[0]?.status;
  const attention = await primary.query(
    `select distinct e.quote_request_id from email_deliveries e
      where e.status<>'provider_accepted' and not exists (
        select 1 from email_deliveries newer
         where newer.quote_request_id=e.quote_request_id and newer.delivery_type=e.delivery_type
           and newer.attempt_sequence>e.attempt_sequence
      ) and e.quote_request_id in (?,?)`,
    [acceptedThenFailed, failedThenAccepted],
  );
  check("same-millisecond accepted-then-failed ordering exposes failure in list/detail ordering",
    await latestStatus(acceptedThenFailed) === "failed" && attention.rows.some((row) => row.quote_request_id === acceptedThenFailed));
  check("same-millisecond failed-then-accepted ordering clears owner attention",
    await latestStatus(failedThenAccepted) === "provider_accepted" && !attention.rows.some((row) => row.quote_request_id === failedThenAccepted));

  let negativeRejected = false;
  try { await primary.query("update business_settings set minimum_order_total=-0.01 where id=1"); }
  catch { negativeRejected = true; }
  check("database constraint rejects a negative quote floor", negativeRejected);
  await primary.query("update business_settings set minimum_order_total='25.00' where id=1");
  check("fixed-point quote floor round-trips exactly",
    (await primary.query("select minimum_order_total from business_settings where id=1")).rows[0]?.minimum_order_total === "25.00");

  const key = randomUUID();
  const firstId = randomUUID();
  const secondId = randomUUID();
  const insert = (db, id) => db.query(
    `insert into quote_requests
       (id,idempotency_key,customer_name,customer_email,pricing_status,calculated_total,calculated_subtotal,minimum_order_adjustment,status)
     values (?,?,'Customer','customer@example.test','priced','25.00','2.00','23.00','request_received')`,
    [id, key],
  );
  const race = await Promise.allSettled([insert(primary, firstId), insert(contender, secondId)]);
  check("database authority permits exactly one concurrent idempotency winner",
    race.filter((result) => result.status === "fulfilled").length === 1
      && race.filter((result) => result.status === "rejected").length === 1);

  const winner = (await primary.query(
    "select id,status,calculated_total,calculated_subtotal,minimum_order_adjustment from quote_requests where idempotency_key=?",
    [key],
  )).rows[0];
  check("winning quote preserves the complete pricing snapshot",
    winner?.calculated_total === "25.00" && winner?.calculated_subtotal === "2.00" && winner?.minimum_order_adjustment === "23.00",
    JSON.stringify(winner));

  await primary.query(
    "insert into email_deliveries(quote_request_id,delivery_type,recipient,status,error_message) values (?,'shop_notification','shop@example.test','failed','provider unavailable')",
    [winner.id],
  );
  await primary.query("update quote_requests set status='request_received' where id=?", [winner.id]);
  const retryLookup = (await contender.query(
    `select q.id,q.status,count(e.id) as delivery_count
       from quote_requests q left join email_deliveries e on e.quote_request_id=q.id
      where q.idempotency_key=? group by q.id,q.status`,
    [key],
  )).rows[0];
  check("failed delivery remains reviewable and retry lookup resolves the original request",
    retryLookup?.id === winner.id && retryLookup?.status === "request_received" && Number(retryLookup?.delivery_count) === 1,
    JSON.stringify(retryLookup));

  const totalRows = await primary.query("select count(*) as n from quote_requests where idempotency_key=?", [key]);
  check("retry/idempotency flow leaves one persisted quote", Number(totalRows.rows[0]?.n) === 1);
} catch (error) {
  failed += 1;
  console.error(`\nIntegration aborted: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  if (contender) await contender.end().catch(() => undefined);
  if (primary) await primary.end().catch(() => undefined);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
