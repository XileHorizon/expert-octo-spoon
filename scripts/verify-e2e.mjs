#!/usr/bin/env node
/** Real MySQL 8 schema/integrity verification. Requires a disposable MYSQL_TEST_URL. */
import { readFileSync } from "node:fs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { openTestDatabase } from "./mysql-test-helper.mjs";

let db, passes = 0, failures = 0;
const check = (label, condition, detail = "") => { if (condition) { passes++; console.log(`  PASS  ${label}`); } else { failures++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`); } };
const sha = (value) => createHash("sha256").update(value).digest("hex");

try {
  console.log("\nMySQL schema and seeds");
  db = await openTestDatabase({ reset: true, seed: true });
  check("schema and both seeds apply", true);
  await db.query(readFileSync("db/schema.sql", "utf8"));
  await db.query(readFileSync("db/seed-required-catalog.sql", "utf8"));
  await db.query(readFileSync("db/seed-pricing-details.sql", "utf8"));
  check("schema and seeds are rerunnable", true);
  const tables = await db.query("select table_name from information_schema.tables where table_schema=database()");
  const required = ["owners","owner_sessions","owner_password_resets","products","sizes","materials","material_sizes","size_papers","bulk_tiers","bulk_tier_sizes","finishing_options","finishing_sizes","fulfillment_options","quote_requests","quote_jobs","email_deliveries","business_settings","admin_activity_log"];
  check(`all ${required.length} tables created`, required.every((name) => tables.rows.some((row) => row.TABLE_NAME === name || row.table_name === name)));
  check("all seven required sizes seeded", Number((await db.query("select count(*) as n from sizes where product_id='10000000-0000-4000-8000-000000000001'")).rows[0].n) === 7);
  check("all twelve paper mappings seeded", Number((await db.query("select count(*) as n from size_papers")).rows[0].n) === 12);
  await db.query("update sizes set base_price='9.8765' where id='20000000-0000-4000-8000-000000000001'");
  await db.query(readFileSync("db/seed-pricing-details.sql", "utf8"));
  check("re-seeding preserves owner pricing", (await db.query("select base_price from sizes where id='20000000-0000-4000-8000-000000000001'")).rows[0].base_price === "9.8765");

  console.log("\nAuthentication data");
  const ownerId = randomUUID();
  const hash = await bcrypt.hash("CorrectHorse9Battery", 12);
  await db.query("insert into owners(id,email,password_hash,active) values (?,?,?,true)", [ownerId, "owner@example.com", hash]);
  let duplicate = false;
  try { await db.query("insert into owners(id,email,password_hash) values (?,?,?)", [randomUUID(), "OWNER@EXAMPLE.COM", hash]); } catch { duplicate = true; }
  check("owner email is case-insensitively unique", duplicate);
  const stored = (await db.query("select password_hash from owners where id=?", [ownerId])).rows[0].password_hash;
  check("password stored as a hash and verifies", !stored.includes("CorrectHorse") && await bcrypt.compare("CorrectHorse9Battery", stored));
  const token = randomBytes(32).toString("base64url");
  await db.query("insert into owner_sessions(token_hash,owner_id,expires_at) values (?,?,date_add(current_timestamp(3), interval 12 hour))", [sha(token), ownerId]);
  check("valid session resolves", (await db.query("select o.id from owner_sessions s join owners o on o.id=s.owner_id where s.token_hash=? and s.expires_at>current_timestamp(3)", [sha(token)])).rowCount === 1);
  await db.query("insert into owner_password_resets(token_hash,owner_id,expires_at) values (?,?,date_add(current_timestamp(3), interval 1 hour))", [sha("reset"), ownerId]);
  await db.query("update owner_password_resets set used_at=current_timestamp(3) where token_hash=?", [sha("reset")]);
  check("used reset token cannot be selected as active", (await db.query("select 1 from owner_password_resets where token_hash=? and used_at is null", [sha("reset")])).rowCount === 0);

  console.log("\nCatalog and quote history");
  const productId = randomUUID(), sizeId = randomUUID(), materialId = randomUUID(), finishId = randomUUID(), fulfillmentId = randomUUID();
  await db.query("insert into products(id,name,minimum_quantity,active) values (?,'Cards',200,true)", [productId]);
  await db.query("insert into sizes(id,product_id,name,base_price,billing_unit,active) values (?,?,'3.5 x 2','0.1850','card',true)", [sizeId, productId]);
  await db.query("insert into materials(id,product_id,name,active) values (?,?,'16pt Matte',true)", [materialId, productId]);
  await db.query("insert into size_papers(size_id,material_id,surcharge,is_standard,active) values (?,?,'0',true,true)", [sizeId, materialId]);
  await db.query("insert into finishing_options(id,name,unit_price,charge_basis,active) values (?,'Rounded','0.03','per_piece',true)", [finishId]);
  await db.query("insert into fulfillment_options(id,name,flat_price,active) values (?,'Pickup','0',true)", [fulfillmentId]);
  let negative = false;
  try { await db.query("insert into materials(id,product_id,name,unit_price) values (?,?,'Bad',-1)", [randomUUID(), productId]); } catch { negative = true; }
  check("MySQL enforces nonnegative pricing", negative);

  const requestId = randomUUID();
  await db.query("insert into quote_requests(id,idempotency_key,customer_name,customer_email,fulfillment_id,fulfillment_name,pricing_status,calculated_total,status) values (?,?,'Customer','customer@example.com',?,'Pickup','priced','37.00','received')", [requestId, randomUUID(), fulfillmentId]);
  await db.query("insert into quote_jobs(id,quote_request_id,client_id,file_name,file_size,mime_type,product_id,size_id,material_id,product_name,size_name,material_name,finishing_names,quantity,sides,finishing_ids,pricing_status,calculated_subtotal) values (?,?, 'job','art.pdf',2048,'application/pdf',?,?,?,?,?,?,?,200,2,?,'priced','37.00')", [randomUUID(), requestId, productId, sizeId, materialId, "Cards", "3.5 x 2", "16pt Matte", JSON.stringify(["Rounded"]), JSON.stringify([finishId])]);
  const history = (await db.query("select product_name,material_name,finishing_names from quote_jobs where quote_request_id=?", [requestId])).rows[0];
  check("quote snapshots and JSON arrays persist", history.product_name === "Cards" && history.material_name === "16pt Matte" && JSON.stringify(history.finishing_names).includes("Rounded"));
  check("JSON history lookup finds finishing usage", (await db.query("select 1 from quote_jobs where json_contains(finishing_ids,json_quote(?))", [finishId])).rowCount === 1);
  let duplicateRequest = false;
  const key = randomUUID();
  await db.query("insert into quote_requests(idempotency_key,customer_name,customer_email,pricing_status,status) values (?,'A','a@b.com','manual','received')", [key]);
  try { await db.query("insert into quote_requests(idempotency_key,customer_name,customer_email,pricing_status,status) values (?,'A','a@b.com','manual','received')", [key]); } catch { duplicateRequest = true; }
  check("idempotency key blocks duplicate requests", duplicateRequest);
  let badStatus = false;
  try { await db.query("update quote_requests set status='deleted' where id=?", [requestId]); } catch { badStatus = true; }
  check("status enum rejects invalid state", badStatus);
  const before = new Date((await db.query("select updated_at from quote_requests where id=?", [requestId])).rows[0].updated_at).getTime();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await db.query("update quote_requests set status='reviewing' where id=?", [requestId]);
  const after = new Date((await db.query("select updated_at from quote_requests where id=?", [requestId])).rows[0].updated_at).getTime();
  check("updated_at advances automatically", after > before);

  const cascadeId = randomUUID();
  await db.query("insert into quote_requests(id,idempotency_key,customer_name,customer_email,pricing_status,status) values (?,?, 'C','c@d.com','manual','received')", [cascadeId, randomUUID()]);
  await db.query("insert into quote_jobs(id,quote_request_id,client_id,file_name,file_size,mime_type,product_id,size_id,material_id,quantity,sides,pricing_status) values (?,?, 'j','f.pdf',10,'application/pdf','p','s','m',1,1,'manual')", [randomUUID(), cascadeId]);
  await db.query("delete from quote_requests where id=?", [cascadeId]);
  check("request deletion cascades to jobs", (await db.query("select 1 from quote_jobs where quote_request_id=?", [cascadeId])).rowCount === 0);
} catch (error) {
  failures++; console.error(`\nVerification aborted: ${error instanceof Error ? error.message : String(error)}`);
} finally { if (db) await db.end().catch(() => {}); }
console.log(`\n${passes} passed, ${failures} failed\n`);
process.exit(failures ? 1 : 0);
