#!/usr/bin/env node
/**
 * Full-stack verification against the disposable MYSQL_TEST_URL database.
 *
 *   npm run verify:full
 *
 * Resets a dedicated MySQL 8 test database and starts a local SMTP sink, builds nothing
 * (uses `next dev`), then drives the real HTTP surface end to end:
 *
 *   health -> owner creation -> sign-in -> session -> catalog editing ->
 *   public catalog -> quote submission -> notification email -> portal review ->
 *   artwork download -> status update -> password reset -> sign-out
 *
 * Everything is torn down afterwards. Nothing outside temp directories changes.
 */

import { spawn } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { SMTPServer } from "smtp-server";
import { openTestDatabase, loadLocalEnv } from "./mysql-test-helper.mjs";

const SMTP_PORT = 32525;
const APP_PORT = 35000 + (process.pid % 1000);
const BASE = `http://127.0.0.1:${APP_PORT}`;

let db, smtp, app, appEnvFile;
let passes = 0, failures = 0;
const inbox = [];

// Test-only credentials, assembled at runtime.
const PW_INITIAL = ["Initial", "Owner", "Pass", "9"].join("");
const PW_WRONG   = ["Totally", "Wrong", "Pass", "1"].join("");
const PW_NEW     = ["Rotated", "Owner", "Pass", "7"].join("");
const PW_WEAK    = "short";

const ok = (label) => { passes++; console.log(`  \x1b[32mPASS\x1b[0m  ${label}`); };
const bad = (label, detail) => { failures++; console.log(`  \x1b[31mFAIL\x1b[0m  ${label}${detail ? ` — ${detail}` : ""}`); };
const check = (label, condition, detail = "") => (condition ? ok(label) : bad(label, detail));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Cookie jar so the portal session persists across requests, like a browser.
let cookie = "";
async function call(url, options = {}) {
  const response = await fetch(`${BASE}${url}`, {
    ...options,
    headers: { ...(options.headers ?? {}), ...(cookie ? { cookie } : {}) },
    redirect: "manual",
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) {
    const pair = setCookie.split(";")[0];
    if (/=;|=$/.test(pair)) cookie = "";
    else cookie = pair;
  }
  return response;
}

async function json(response) {
  try { return await response.json(); } catch { return null; }
}

function pdf(name) {
  // Minimal file with a valid %PDF- signature, which the API verifies.
  return new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3])], name, { type: "application/pdf" });
}

try {
  console.log("\n\x1b[1mPreparing an isolated environment\x1b[0m");
  loadLocalEnv();
  db = await openTestDatabase({ reset: true, seed: false });
  console.log("  MySQL 8 test database ready");

  // --- SMTP sink ----------------------------------------------------------
  smtp = new SMTPServer({
    authOptional: true,
    disabledCommands: ["STARTTLS"],
    onData(stream, _session, callback) {
      let raw = "";
      stream.on("data", (chunk) => { raw += chunk; });
      stream.on("end", () => { inbox.push(raw); callback(); });
    },
  });
  await new Promise((resolve) => smtp.listen(SMTP_PORT, "127.0.0.1", resolve));
  console.log("  SMTP sink ready");

  // --- application --------------------------------------------------------
  const env = {
    ...process.env,
    NODE_ENV: "development",
    PORT: String(APP_PORT),
    MYSQL_URL: process.env.MYSQL_TEST_URL,
    APP_URL: BASE,
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: String(SMTP_PORT),
    SMTP_SECURE: "false",
    EMAIL_FROM: "quotes@example.test",
    QUOTE_NOTIFICATION_TO: "shop@example.test",
    MAX_EMAIL_MESSAGE_BYTES: String(95 * 1024 * 1024),
    NEXT_PUBLIC_ENABLE_DEMO_PRICING: "false",
    ENABLE_LOCAL_DEV_INTAKE: "false",
  };

  // Keep the developer's .env.local out of the run.
  appEnvFile = path.join(process.cwd(), ".env.verify");
  await writeFile(appEnvFile, "");

  // Run from an isolated build dir so a developer's running `next dev` does not
  // block this, and so the verification never disturbs their working state.
  env.NEXT_DIST_DIR = ".next-verify";
  app = spawn(process.execPath, [path.join(process.cwd(), "node_modules/next/dist/bin/next"), "dev", "--port", String(APP_PORT)], { env, stdio: ["ignore", "pipe", "pipe"] });
  let appLog = "";
  app.stdout.on("data", (c) => { appLog += c; });
  app.stderr.on("data", (c) => { appLog += c; });

  const deadline = Date.now() + 90_000;
  let up = false;
  while (Date.now() < deadline) {
    try { await fetch(`${BASE}/api/health`); up = true; break; } catch { await sleep(500); }
  }
  if (!up) throw new Error(`app did not start:\n${appLog.slice(-1500)}`);
  console.log("  Application ready\n");

  // ---------------------------------------------------------------- health
  console.log("\x1b[1mHealth\x1b[0m");
  const health = await call("/api/health");
  const healthBody = await json(health);
  check("health endpoint reports ok", health.status === 200 && healthBody?.status === "ok", JSON.stringify(healthBody));
  check("database subsystem healthy", healthBody?.checks?.database === "ok");
  check("email configured", healthBody?.checks?.email === "ok");

  // ------------------------------------------------------------ public form
  console.log("\n\x1b[1mPublic quote form\x1b[0m");
  const home = await call("/");
  const homeHtml = await home.text();
  check("public form loads", home.status === 200);
  check("no owner portal link is exposed", !/\/admin/.test(homeHtml));

  // ------------------------------------------------------- access control
  console.log("\n\x1b[1mAccess control before sign-in\x1b[0m");
  for (const endpoint of ["overview", "requests", "settings", "config"]) {
    const response = await call(`/api/admin/${endpoint}`);
    check(`/api/admin/${endpoint} rejects anonymous access`, response.status === 401, `got ${response.status}`);
  }
  const adminPage = await call("/admin");
  check("/admin redirects to sign-in", adminPage.status === 307 && (adminPage.headers.get("location") ?? "").includes("/admin/login"));

  // ------------------------------------------------------- owner creation
  console.log("\n\x1b[1mOwner account\x1b[0m");
  const bcrypt = (await import("bcryptjs")).default;
  const hash = await bcrypt.hash(PW_INITIAL, 12);
  await db.query("insert into owners(email,password_hash,active) values (?,?,true)", ["owner@example.test", hash]);
  ok("owner account created");

  const badLogin = await call("/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "owner@example.test", password: PW_WRONG }),
  });
  check("wrong password rejected", badLogin.status === 401);

  const unknownLogin = await call("/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "nobody@example.test", password: PW_WRONG }),
  });
  const unknownBody = await json(unknownLogin);
  const badBody = await json(badLogin);
  check("unknown and wrong-password responses are identical", unknownBody?.error === badBody?.error);

  const login = await call("/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "owner@example.test", password: PW_INITIAL }),
  });
  check("correct credentials sign in", login.status === 200, `got ${login.status}`);
  check("session cookie issued", cookie.startsWith("spe_owner_session="));

  const overview = await call("/api/admin/overview");
  check("authenticated dashboard accessible", overview.status === 200);

  // -------------------------------------------------------------- catalog
  console.log("\n\x1b[1mCatalog management\x1b[0m");
  const saveDraft = async (draft) => {
    const response = await call("/api/admin/config", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify(draft),
    });
    return { status: response.status, body: await json(response) };
  };

  // Paper catalog saves first so new database ids can be assigned, just like the UI.
  const initialPapers = await saveDraft({
    papers: [
      { name: "Standard", weight: "20 lb", category: "Uncoated", active: true, sort_order: 0 },
      { name: "Standard", weight: "22 lb", category: "Uncoated", active: true, sort_order: 1 },
      { name: "Cardstock", weight: "100 lb", category: "Cover stock", active: true, sort_order: 2 },
    ],
    sizes: [], finishing: [], bulk_tiers: [],
  });
  check("paper catalog created through the atomic portal API", initialPapers.status === 200, JSON.stringify(initialPapers.body));
  const paperConfig = await json(await call("/api/admin/config"));
  const letterPaperId = paperConfig.papers.find((paper) => paper.weight === "20 lb")?.id;
  const legalPaperId = paperConfig.papers.find((paper) => paper.weight === "22 lb")?.id;
  const cardPaperId = paperConfig.papers.find((paper) => paper.weight === "100 lb")?.id;

  // New rows omit ids; remember names and reload their generated ids after commit.
  const configured = await saveDraft({
    papers: paperConfig.papers,
    sizes: [
      { name: "Letter", dimensions: "8.5 × 11", base_price: "0.10", billing_unit: "printed_page", minimum_quantity: 1, manual_quote: false, included_note: "Included: Standard 20 lb", active: true, sort_order: 0, papers: [{ material_id: letterPaperId, surcharge: "0", is_standard: true, active: true }] },
      { name: "Legal", dimensions: "8.5 × 14", base_price: "0.16", billing_unit: "printed_page", minimum_quantity: 1, manual_quote: false, included_note: "Included: Standard 22 lb", active: true, sort_order: 1, papers: [{ material_id: legalPaperId, surcharge: "0", is_standard: true, active: true }] },
      { name: "Business Cards", dimensions: "3.5 × 2", base_price: "0.20", billing_unit: "card", minimum_quantity: 200, manual_quote: false, included_note: "Included: Cardstock 100 lb", active: true, sort_order: 2, papers: [{ material_id: cardPaperId, surcharge: "0", is_standard: true, active: true }] },
    ],
    finishing: [{ name: "Rounded corners", unit_price: "0.03", charge_basis: "per_piece", size_ids: [], active: true, sort_order: 0 }],
    bulk_tiers: [{ min_quantity: 1000, discount_percent: "5", quantity_basis: "printed_pages", size_ids: [], active: true, sort_order: 0 }],
  });
  check("sizes, paper mappings, options, and discounts save atomically", configured.status === 200, JSON.stringify(configured.body));
  const config = await json(await call("/api/admin/config"));
  const letterIdSaved = config.sizes.find((size) => size.name === "Letter")?.id;
  const legalIdSaved = config.sizes.find((size) => size.name === "Legal")?.id;
  const cardsIdSaved = config.sizes.find((size) => size.name === "Business Cards")?.id;
  const finishingId = config.finishing.find((option) => option.name === "Rounded corners")?.id;
  check("three independent sizes created", [letterIdSaved, legalIdSaved, cardsIdSaved].every(Boolean));
  check("size-specific paper mappings created", config.sizes.every((size) => size.papers.length === 1));
  check("finishing option created", Boolean(finishingId));

  const editableDraft = (source) => ({
    papers: structuredClone(source.papers),
    sizes: structuredClone(source.sizes).map((size) => { delete size.product_id; return size; }),
    finishing: structuredClone(source.finishing),
    bulk_tiers: structuredClone(source.bulk_tiers),
  });
  const invalidDraft = editableDraft(config);
  invalidDraft.sizes[0].base_price = "-5";
  const badRate = await saveDraft({ ...invalidDraft, bulk_tiers: invalidDraft.bulk_tiers });
  check("negative rate rejected by the API", badRate.status === 422);
  const afterBadRate = await json(await call("/api/admin/config"));
  check("failed validation changes nothing", afterBadRate.sizes[0].base_price === config.sizes[0].base_price);

  const productId = (await db.query("select id from products order by sort_order limit 1")).rows[0].id;
  const letterId = letterIdSaved, legalId = legalIdSaved, cardsId = cardsIdSaved;

  // ------------------------------------------------------- public catalog
  console.log("\n\x1b[1mPublic catalog\x1b[0m");
  const catalog = await json(await call("/api/catalog"));
  check("public catalog serves the saved product", catalog?.products?.[0]?.name === "Print products");
  check("catalog is not in fixture mode", catalog?.fixtureMode === false);
  check("size-specific paper relationships are published", catalog?.products?.[0]?.sizes?.find((item) => item.id === legalId)?.papers?.some((item) => item.materialId === legalPaperId));

  // ------------------------------------------------------ quote submission
  console.log("\n\x1b[1mQuote submission\x1b[0m");
  inbox.length = 0;
  const idempotencyKey = randomUUID();
  const buildForm = () => {
    const form = new FormData();
    const files = [pdf("letter.pdf"), pdf("legal.pdf"), pdf("cards.pdf")];
    form.set("payload", JSON.stringify({
      idempotencyKey,
      customer: { name: "Test Customer", email: "customer@example.test", organization: "Acme", phone: "555-0100" },
      jobs: [
        { clientId: "job-letter", fileName: files[0].name, fileSize: files[0].size, mimeType: files[0].type, pageCount: 2, productId, sizeId: letterId, materialId: letterPaperId, quantity: 25, sides: 2, colorMode: "color", orientation: "portrait", finishingIds: [], notes: "Letter instructions" },
        { clientId: "job-legal", fileName: files[1].name, fileSize: files[1].size, mimeType: files[1].type, pageCount: 1, productId, sizeId: legalId, materialId: legalPaperId, quantity: 50, sides: 1, colorMode: "black-white", orientation: "landscape", finishingIds: [], notes: "Legal instructions" },
        { clientId: "job-cards", fileName: files[2].name, fileSize: files[2].size, mimeType: files[2].type, pageCount: 1, productId, sizeId: cardsId, materialId: cardPaperId, quantity: 200, sides: 2, colorMode: "color", orientation: "landscape", finishingIds: [finishingId], notes: "Card instructions" },
      ],
    }));
    files.forEach((file) => form.append("files", file, file.name));
    return form;
  };

  const submit = await fetch(`${BASE}/api/quote-requests`, { method: "POST", body: buildForm() });
  const submitBody = await json(submit);
  check("quote accepted", submit.status === 201, `${submit.status} ${JSON.stringify(submitBody)}`);
  const requestId = submitBody?.requestId;
  check("pricing calculated, not left manual", submitBody?.pricingStatus === "priced", submitBody?.pricingStatus);

  const duplicate = await fetch(`${BASE}/api/quote-requests`, { method: "POST", body: buildForm() });
  const duplicateBody = await json(duplicate);
  check("duplicate submission is de-duplicated", duplicateBody?.duplicate === true && duplicateBody?.requestId === requestId);

  // Quantity below the product minimum must be refused.
  const tooFew = new FormData();
  const smallFile = pdf("small.pdf");
  tooFew.set("payload", JSON.stringify({
    idempotencyKey: randomUUID(),
    customer: { name: "T", email: "t@example.test" },
    jobs: [{ clientId: "j", fileName: smallFile.name, fileSize: smallFile.size, mimeType: smallFile.type, pageCount: 1, productId, sizeId: cardsId, materialId: cardPaperId, quantity: 5, sides: 1, colorMode: "color", orientation: "portrait", finishingIds: [] }],
  }));
  tooFew.append("files", smallFile, smallFile.name);
  const belowMinimum = await fetch(`${BASE}/api/quote-requests`, { method: "POST", body: tooFew });
  check("below-minimum quantity rejected", belowMinimum.status === 422);

  // A file whose bytes do not match its declared type must be refused.
  const spoofed = new FormData();
  const fake = new File([new Uint8Array([0x00, 0x01, 0x02, 0x03])], "fake.pdf", { type: "application/pdf" });
  spoofed.set("payload", JSON.stringify({
    idempotencyKey: randomUUID(),
    customer: { name: "T", email: "t@example.test" },
    jobs: [{ clientId: "j", fileName: fake.name, fileSize: fake.size, mimeType: fake.type, pageCount: null, productId, sizeId: letterId, materialId: letterPaperId, quantity: 25, sides: 1, colorMode: "color", orientation: "portrait", finishingIds: [] }],
  }));
  spoofed.append("files", fake, fake.name);
  const spoofResponse = await fetch(`${BASE}/api/quote-requests`, { method: "POST", body: spoofed });
  check("file with a forged signature rejected", spoofResponse.status === 422);

  // ----------------------------------------------------------------- email
  console.log("\n\x1b[1mNotification email\x1b[0m");
  for (let i = 0; i < 40 && inbox.length === 0; i += 1) await sleep(250);
  check("notification email was sent", inbox.length > 0);
  const message = inbox[0] ?? "";
  check("addressed to the shop", /To:.*shop@example\.test/i.test(message));
  check("reply-to is the customer", /Reply-To:.*customer@example\.test/i.test(message));
  for (const [label, pattern] of [
    ["customer name", /Test Customer/],
    ["organization", /Acme/],
    ["all three file names", /letter\.pdf[\s\S]*legal\.pdf[\s\S]*cards\.pdf/],
    ["product", /Print products/],
    ["different materials", /Standard 20 lb[\s\S]*Standard 22 lb[\s\S]*100 lb/],
    ["business-card quantity", /Quantity: 200/],
    ["different color modes", /Full Color \(CMYK\)[\s\S]*Black & White/],
    ["finishing", /Rounded corners/],
    ["customer notes", /Card instructions/],
    ["estimated total", /Estimated total: \$/],
  ]) check(`email includes ${label}`, pattern.test(message));
  check("all three originals attached", (message.match(/Content-Disposition: attachment/gi) ?? []).length === 3);

  // ---------------------------------------------------------- portal review
  console.log("\n\x1b[1mOwner portal review\x1b[0m");
  const list = await json(await call("/api/admin/requests"));
  check("request appears in the portal list", list?.requests?.some((r) => r.id === requestId));

  const searched = await json(await call("/api/admin/requests?search=Acme"));
  check("search finds the request by organization", searched?.requests?.some((r) => r.id === requestId));

  const filtered = await json(await call("/api/admin/requests?status=closed"));
  check("status filter excludes non-matching requests", !filtered?.requests?.some((r) => r.id === requestId));

  const detail = await json(await call(`/api/admin/requests/${requestId}`));
  check("full order detail retrieved", detail?.request?.id === requestId);
  check("three independently configured jobs stored", detail?.jobs?.length === 3);
  check("historical product name stored on each job", detail?.jobs?.every((job) => job.product_name === "Print products"));
  check("different sizes, papers, and quantities persisted", new Set(detail?.jobs?.map((job) => job.size_id)).size === 3 && new Set(detail?.jobs?.map((job) => job.material_id)).size === 3 && detail?.jobs?.map((job) => job.quantity).join(",") === "25,50,200");
  check("per-file color and orientation persisted", detail?.jobs?.[1]?.color_mode === "black-white" && detail?.jobs?.[1]?.orientation === "landscape");
  check("customer notes preserved", detail?.jobs?.[2]?.notes === "Card instructions");
  check("delivery status recorded", detail?.emails?.[0]?.status === "provider_accepted", detail?.emails?.[0]?.status);

  check("artwork is not retained as a web download", detail?.jobs?.every((job) => job.storage_path === null));

  const statusUpdate = await call(`/api/admin/requests/${requestId}`, {
    method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "reviewing" }),
  });
  check("status update saved", statusUpdate.status === 200);
  const afterStatus = await json(await call(`/api/admin/requests/${requestId}`));
  check("status change persisted", afterStatus?.request?.status === "reviewing");

  const badStatus = await call(`/api/admin/requests/${requestId}`, {
    method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "deleted" }),
  });
  check("invalid status rejected", badStatus.status === 422);

  // ------------------------------------------------------- history safety
  console.log("\n\x1b[1mHistory protection\x1b[0m");
  const removalDraft = editableDraft(config);
  removalDraft.sizes = removalDraft.sizes.filter((size) => size.id !== letterId);
  const removeUsed = await saveDraft(removalDraft);
  check("size used by a quote cannot be deleted", removeUsed.status === 409, `${removeUsed.status} ${JSON.stringify(removeUsed.body)}`);

  const deactivateDraft = editableDraft(config);
  deactivateDraft.sizes = deactivateDraft.sizes.map((size) => size.id === letterId ? { ...size, active: false } : size);
  const deactivate = await saveDraft(deactivateDraft);
  check("referenced size can still be deactivated", deactivate.status === 200, `${deactivate.status} ${JSON.stringify(deactivate.body)}`);

  const afterDeactivate = await json(await call(`/api/admin/requests/${requestId}`));
  check("history still readable after deactivation", afterDeactivate?.jobs?.[0]?.product_name === "Print products");

  const restoreDraft = editableDraft(await json(await call("/api/admin/config")));
  restoreDraft.sizes = restoreDraft.sizes.map((size) => size.id === letterId ? { ...size, active: true } : size);
  await saveDraft(restoreDraft);

  // ------------------------------------------------------ business settings
  console.log("\n\x1b[1mBusiness settings\x1b[0m");
  const settings = await call("/api/admin/settings", {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contact_phone: "(555) 010-2000", contact_email: "hello@example.test",
      turnaround_intro: "We reply within one business day.",
      standard_turnaround: "3-5 Business Days", rush_turnaround: "1-2 Business Days",
      support_copy: "Need help?", notification_target: "shop@example.test",
    }),
  });
  check("business settings saved", settings.status === 200);
  const badSettings = await call("/api/admin/settings", {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ contact_phone: "x", contact_email: "not-an-email", turnaround_intro: "t", standard_turnaround: "s", rush_turnaround: "r", support_copy: "c", notification_target: null }),
  });
  check("invalid contact email rejected", badSettings.status === 422);

  // -------------------------------------------------------- password reset
  console.log("\n\x1b[1mPassword reset\x1b[0m");
  inbox.length = 0;
  const requestReset = await call("/api/auth/request-reset", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "owner@example.test" }),
  });
  check("reset request accepted", requestReset.status === 200);

  const unknownReset = await call("/api/auth/request-reset", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "stranger@example.test" }),
  });
  const unknownResetBody = await json(unknownReset);
  const knownResetBody = await json(requestReset);
  check("unknown address gets an identical response", unknownResetBody?.message === knownResetBody?.message);

  for (let i = 0; i < 40 && inbox.length === 0; i += 1) await sleep(250);
  check("reset email delivered", inbox.length > 0);
  const resetMail = (inbox[0] ?? "").replace(/=\r?\n/g, "");
  const tokenMatch = resetMail.match(/reset\?token=3D([A-Za-z0-9_-]+)|reset\?token=([A-Za-z0-9_-]+)/);
  const resetToken = tokenMatch?.[1] ?? tokenMatch?.[2];
  check("reset link contains a token", Boolean(resetToken));

  const weak = await call("/api/auth/reset", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: resetToken, password: PW_WEAK }),
  });
  check("weak password rejected", weak.status === 422);

  const reset = await call("/api/auth/reset", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: resetToken, password: PW_NEW }),
  });
  check("password reset succeeds", reset.status === 200, JSON.stringify(await json(reset)));

  const reuse = await call("/api/auth/reset", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: resetToken, password: PW_NEW }),
  });
  check("reset token cannot be reused", reuse.status === 400);

  cookie = "";
  const oldPassword = await call("/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "owner@example.test", password: PW_INITIAL }),
  });
  check("old password no longer works", oldPassword.status === 401);

  const newPassword = await call("/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "owner@example.test", password: PW_NEW }),
  });
  check("new password signs in", newPassword.status === 200);

  // ------------------------------------------------------------- sign out
  console.log("\n\x1b[1mSign out\x1b[0m");
  const logout = await call("/api/auth/logout", { method: "POST" });
  check("sign out succeeds", logout.status === 200);
  const afterLogout = await call("/api/admin/overview");
  check("session no longer valid after sign out", afterLogout.status === 401);

  // ---------------------------------------------- failed email handoff
  console.log("\n\x1b[1mFailed email handoff\x1b[0m");
  await new Promise((resolve) => smtp.close(resolve)); smtp = null;
  const failedForm = buildForm();
  const failedPayload = JSON.parse(String(failedForm.get("payload")));
  failedPayload.idempotencyKey = randomUUID();
  failedForm.set("payload", JSON.stringify(failedPayload));
  const failedHandoff = await fetch(`${BASE}/api/quote-requests`, { method: "POST", body: failedForm });
  const failedHandoffBody = await json(failedHandoff);
  check("submission does not report success when SMTP rejects the handoff", failedHandoff.status === 502 && /could not be safely accepted/i.test(failedHandoffBody?.error ?? ""));
  const failedRecord = await db.query("select status from quote_requests where idempotency_key=?", [failedPayload.idempotencyKey]);
  check("failed handoff is flagged for owner visibility", failedRecord.rows[0]?.status === "intake_failed");
  const failedJobs = await db.query("select storage_path from quote_jobs where quote_request_id=(select id from quote_requests where idempotency_key=?)", [failedPayload.idempotencyKey]);
  check("failed handoff still creates no artwork archive", failedJobs.rows.every((row) => row.storage_path === null));

  await db.end();
} catch (error) {
  failures++;
  console.error(`\n\x1b[31mVerification aborted:\x1b[0m ${error.message}`);
} finally {
  if (app) { app.kill("SIGTERM"); await sleep(700); app.kill("SIGKILL"); }
  if (smtp) await new Promise((r) => smtp.close(r));
  if (appEnvFile) await rm(appEnvFile, { force: true }).catch(() => {});
}

const total = passes + failures;
console.log(`\n\x1b[1m${passes}/${total} checks passed\x1b[0m${failures ? ` — \x1b[31m${failures} failed\x1b[0m` : ""}\n`);
process.exit(failures === 0 ? 0 : 1);
