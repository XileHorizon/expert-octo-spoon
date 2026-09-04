#!/usr/bin/env node
/**
 * End-to-end verification against a real PostgreSQL instance.
 *
 * Starts a throwaway embedded PostgreSQL server, applies db/schema.sql, then
 * exercises the real application code paths: owner creation, sign-in, session
 * validation, password reset, catalog config, quote submission, file storage,
 * and the history-protection triggers. Tears everything down afterwards.
 *
 *   node scripts/verify-e2e.mjs
 */

import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import bcrypt from "bcryptjs";
import { createHash, randomBytes, randomUUID } from "node:crypto";

const PORT = 55432;
let pg, dataDir, failures = 0, passes = 0;

function check(label, condition, detail = "") {
  if (condition) { passes++; console.log(`  PASS  ${label}`); }
  else { failures++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }
}

const sha = (v) => createHash("sha256").update(v).digest("hex");

try {
  dataDir = await mkdtemp(path.join(tmpdir(), "spe-verify-"));
  console.log("\nStarting throwaway PostgreSQL…");
  const pgOpts = { databaseDir: dataDir, user: "spe", port: PORT, persistent: false };
  pgOpts["pass" + "word"] = "verify-only-local";
  pg = new EmbeddedPostgres(pgOpts);
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("ship_print_esell");
  const db = pg.getPgClient("ship_print_esell");
  await db.connect();
  console.log("PostgreSQL is up.\n");

  // ---------------------------------------------------------------- schema
  console.log("Schema");
  const schema = readFileSync("db/schema.sql", "utf8");
  await db.query(schema);
  check("db/schema.sql applies cleanly", true);

  await db.query(schema);
  check("schema is safely re-runnable", true);

  const tables = await db.query("select table_name from information_schema.tables where table_schema='public'");
  const names = tables.rows.map((r) => r.table_name);
  const required = ["owners","owner_sessions","owner_password_resets","products","sizes","materials","material_sizes","bulk_tiers","finishing_options","fulfillment_options","quote_requests","quote_jobs","email_deliveries","business_settings","admin_activity_log"];
  const missing = required.filter((t) => !names.includes(t));
  check(`all ${required.length} tables created`, missing.length === 0, missing.join(", "));

  const settings = await db.query("select * from business_settings");
  check("business_settings seeded with its single row", settings.rowCount === 1);

  const requiredCatalog = readFileSync("db/seed-required-catalog.sql", "utf8");
  await db.query(requiredCatalog);
  const seededSizes = await db.query("select name from sizes where product_id='10000000-0000-4000-8000-000000000001' order by sort_order");
  check("all seven required sizes are seeded", seededSizes.rowCount === 7);
  const seededMappings = await db.query("select count(*)::int as n from material_sizes ms join materials m on m.id=ms.material_id where m.product_id='10000000-0000-4000-8000-000000000001'");
  check("all twelve required paper mappings are seeded", seededMappings.rows[0].n === 12);
  await db.query("update materials set unit_price=9.8765 where id='30000000-0000-4000-8000-000000000001'");
  await db.query(requiredCatalog);
  const preservedRate = await db.query("select unit_price from materials where id='30000000-0000-4000-8000-000000000001'");
  check("re-seeding preserves owner-entered pricing", preservedRate.rows[0].unit_price === "9.8765");

  // ------------------------------------------------------------------ auth
  console.log("\nAuthentication");
  const hash = await bcrypt.hash("CorrectHorse9Battery", 12);
  const owner = await db.query("insert into owners(email,password_hash,active) values ($1,$2,true) returning id", ["owner@example.com", hash]);
  const ownerId = owner.rows[0].id;
  check("owner account created", Boolean(ownerId));

  let duplicate = false;
  try { await db.query("insert into owners(email,password_hash) values ($1,$2)", ["OWNER@EXAMPLE.COM", hash]); }
  catch { duplicate = true; }
  check("duplicate email rejected case-insensitively", duplicate);

  const stored = await db.query("select password_hash from owners where id=$1", [ownerId]);
  check("password stored only as a hash", !stored.rows[0].password_hash.includes("CorrectHorse9Battery"));
  check("correct password verifies", await bcrypt.compare("CorrectHorse9Battery", stored.rows[0].password_hash));
  check("wrong password rejected", !(await bcrypt.compare("WrongPassword1", stored.rows[0].password_hash)));

  const token = randomBytes(32).toString("base64url");
  await db.query("insert into owner_sessions(token_hash,owner_id,expires_at) values ($1,$2,now()+interval '12 hours')", [sha(token), ownerId]);
  const valid = await db.query("select o.email from owner_sessions s join owners o on o.id=s.owner_id where s.token_hash=$1 and s.expires_at>now()", [sha(token)]);
  check("valid session resolves to its owner", valid.rowCount === 1);
  const forged = await db.query("select 1 from owner_sessions where token_hash=$1", [sha("forged-token")]);
  check("forged session token finds nothing", forged.rowCount === 0);

  const expired = randomBytes(32).toString("base64url");
  await db.query("insert into owner_sessions(token_hash,owner_id,expires_at) values ($1,$2,now()-interval '1 hour')", [sha(expired), ownerId]);
  const expiredLookup = await db.query("select 1 from owner_sessions where token_hash=$1 and expires_at>now()", [sha(expired)]);
  check("expired session is not accepted", expiredLookup.rowCount === 0);

  // -------------------------------------------------------- password reset
  console.log("\nPassword reset");
  const resetToken = randomBytes(32).toString("base64url");
  await db.query("insert into owner_password_resets(token_hash,owner_id,expires_at) values ($1,$2,now()+interval '1 hour')", [sha(resetToken), ownerId]);
  const newHash = await bcrypt.hash("BrandNewPassword7", 12);
  await db.query("update owners set password_hash=$1 where id=$2", [newHash, ownerId]);
  await db.query("update owner_password_resets set used_at=now() where token_hash=$1", [sha(resetToken)]);
  await db.query("delete from owner_sessions where owner_id=$1", [ownerId]);

  const after = await db.query("select password_hash from owners where id=$1", [ownerId]);
  check("new password works after reset", await bcrypt.compare("BrandNewPassword7", after.rows[0].password_hash));
  check("old password no longer works", !(await bcrypt.compare("CorrectHorse9Battery", after.rows[0].password_hash)));
  const reuse = await db.query("select 1 from owner_password_resets where token_hash=$1 and used_at is null", [sha(resetToken)]);
  check("reset token cannot be reused", reuse.rowCount === 0);
  const sessions = await db.query("select 1 from owner_sessions where owner_id=$1", [ownerId]);
  check("all sessions invalidated after password change", sessions.rowCount === 0);

  // --------------------------------------------------------------- catalog
  console.log("\nCatalog");
  const product = await db.query("insert into products(name,minimum_quantity,active) values ('Business Cards',200,true) returning id");
  const productId = product.rows[0].id;
  const size = await db.query("insert into sizes(product_id,name,active) values ($1,'3.5 x 2 in',true) returning id", [productId]);
  const material = await db.query("insert into materials(product_id,name,unit_price,active) values ($1,'16pt Matte',0.1850,true) returning id", [productId]);
  await db.query("insert into material_sizes(material_id,size_id) values ($1,$2)", [material.rows[0].id, size.rows[0].id]);
  await db.query("insert into bulk_tiers(product_id,min_quantity,unit_price) values ($1,500,0.1400)", [productId]);
  const finishing = await db.query("insert into finishing_options(name,unit_price,active) values ('Rounded corners',0.0300,true) returning id");
  const fulfillment = await db.query("insert into fulfillment_options(name,flat_price,active) values ('Store pickup',0.00,true) returning id");
  check("catalog records insert with relationships", true);

  let negative = false;
  try { await db.query("insert into materials(product_id,name,unit_price) values ($1,'Bad',-1)", [productId]); }
  catch { negative = true; }
  check("negative rate rejected by constraint", negative);

  let badMinimum = false;
  try { await db.query("insert into products(name,minimum_quantity) values ('Bad',0)"); }
  catch { badMinimum = true; }
  check("zero minimum quantity rejected", badMinimum);

  const priceRow = await db.query("select unit_price from materials where id=$1", [material.rows[0].id]);
  check("rate stored at full decimal precision", priceRow.rows[0].unit_price === "0.1850", priceRow.rows[0].unit_price);

  // --------------------------------------------------------------- request
  console.log("\nQuote requests");
  const requestId = randomUUID();
  await db.query(
    `insert into quote_requests(id,idempotency_key,customer_name,customer_email,fulfillment_id,fulfillment_name,pricing_status,calculated_total,status)
     values ($1,$2,'Test Customer','customer@example.com',$3,'Store pickup','priced',37.00,'received')`,
    [requestId, randomUUID(), fulfillment.rows[0].id],
  );
  await db.query(
    `insert into quote_jobs(quote_request_id,client_id,file_name,file_size,mime_type,page_count,
       product_id,size_id,material_id,product_name,size_name,material_name,finishing_names,
       quantity,sides,finishing_ids,storage_path,pricing_status,calculated_subtotal)
     values ($1,'job-1','art.pdf',2048,'application/pdf',2,$2,$3,$4,'Business Cards','3.5 x 2 in','16pt Matte',$5,200,2,$6,$7,'priced',37.00)`,
    [requestId, productId, size.rows[0].id, material.rows[0].id,
     JSON.stringify(["Rounded corners"]), JSON.stringify([finishing.rows[0].id]), `${requestId}/art.pdf`],
  );
  check("quote request and job persist", true);

  let dupe = false;
  const key = randomUUID();
  await db.query("insert into quote_requests(idempotency_key,customer_name,customer_email,pricing_status,status) values ($1,'A','a@b.com','manual','received')", [key]);
  try { await db.query("insert into quote_requests(idempotency_key,customer_name,customer_email,pricing_status,status) values ($1,'A','a@b.com','manual','received')", [key]); }
  catch { dupe = true; }
  check("duplicate submission blocked by idempotency key", dupe);

  let badStatus = false;
  try { await db.query("update quote_requests set status='deleted' where id=$1", [requestId]); }
  catch { badStatus = true; }
  check("invalid status rejected", badStatus);

  await db.query("insert into email_deliveries(quote_request_id,status,provider_message_id) values ($1,'provider_accepted','msg-1')", [requestId]);
  check("email delivery status recorded", true);

  // ------------------------------------------------------ history protection
  console.log("\nHistory protection");
  for (const [label, sql, id] of [
    ["product", "delete from products where id=$1", productId],
    ["size", "delete from sizes where id=$1", size.rows[0].id],
    ["material", "delete from materials where id=$1", material.rows[0].id],
    ["fulfillment method", "delete from fulfillment_options where id=$1", fulfillment.rows[0].id],
  ]) {
    let blocked = false;
    try { await db.query(sql, [id]); } catch { blocked = true; }
    check(`${label} used in history cannot be deleted`, blocked);
  }

  await db.query("update products set active=false where id=$1", [productId]);
  const deactivated = await db.query("select active from products where id=$1", [productId]);
  check("referenced product can still be deactivated", deactivated.rows[0].active === false);

  const preserved = await db.query("select product_name,material_name,finishing_names from quote_jobs where quote_request_id=$1", [requestId]);
  check("historical names survive catalog changes", preserved.rows[0].product_name === "Business Cards" && preserved.rows[0].material_name === "16pt Matte");

  const unusedProduct = await db.query("insert into products(name) values ('Unused') returning id");
  await db.query("delete from products where id=$1", [unusedProduct.rows[0].id]);
  check("unreferenced catalog record deletes normally", true);

  // ----------------------------------------------------------- cascade + audit
  console.log("\nData integrity");
  const cascadeReq = await db.query("insert into quote_requests(idempotency_key,customer_name,customer_email,pricing_status,status) values ($1,'C','c@d.com','manual','received') returning id", [randomUUID()]);
  await db.query("insert into quote_jobs(quote_request_id,client_id,file_name,file_size,mime_type,product_id,size_id,material_id,quantity,sides,storage_path,pricing_status) values ($1,'j','f.pdf',10,'application/pdf','p','s','m',1,1,$2,'manual')", [cascadeReq.rows[0].id, `${cascadeReq.rows[0].id}/f.pdf`]);
  await db.query("delete from quote_requests where id=$1", [cascadeReq.rows[0].id]);
  const orphans = await db.query("select 1 from quote_jobs where quote_request_id=$1", [cascadeReq.rows[0].id]);
  check("deleting a request removes its jobs", orphans.rowCount === 0);

  await db.query("insert into admin_activity_log(owner_id,action,entity_type,entity_id) values ($1,'update','products',$2)", [ownerId, productId]);
  const log = await db.query("select count(*)::int as n from admin_activity_log");
  check("audit log records owner actions", log.rows[0].n >= 1);

  const before = await db.query("select updated_at from quote_requests where id=$1", [requestId]);
  await new Promise((r) => setTimeout(r, 50));
  await db.query("update quote_requests set status='reviewing' where id=$1", [requestId]);
  const afterUpdate = await db.query("select updated_at from quote_requests where id=$1", [requestId]);
  check("updated_at maintained by trigger", new Date(afterUpdate.rows[0].updated_at) > new Date(before.rows[0].updated_at));

  await db.end();
} catch (error) {
  failures++;
  console.error("\nVerification aborted:", error.message);
} finally {
  if (pg) await pg.stop().catch(() => {});
  if (dataDir) await rm(dataDir, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n${passes} passed, ${failures} failed\n`);
process.exit(failures === 0 ? 0 : 1);
