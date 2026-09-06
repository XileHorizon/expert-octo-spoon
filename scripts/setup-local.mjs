#!/usr/bin/env node
/** Cross-platform, credential-safe MySQL 8 setup. Reuses configured DB, Docker, or native MySQL. */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import mysql from "mysql2/promise";

const DATABASE = "ship_print_esell";
const TEST_DATABASE = "ship_print_esell_test";
const USER = "ship_print";
const CONTAINER = "ship-print-esell-mysql";
const CONTAINER_PORT = 3307;
const CONTAINER_ENV = ".local-data/mysql-container.env";

function command(name) {
  const finder = process.platform === "win32" ? "where" : "which";
  try { return execFileSync(finder, [name], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split(/\r?\n/)[0].trim(); }
  catch { return ""; }
}
function run(program, args, options = {}) { return spawnSync(program, args, { stdio: "inherit", ...options }); }
function fail(message) { console.error(`\n${message}\n`); process.exit(1); }
function loadEnvFile() {
  if (!existsSync(".env.local")) return;
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}
async function canConnect(url) {
  if (!url) return false;
  try { const connection = await mysql.createConnection(url); await connection.query("select 1"); await connection.end(); return true; }
  catch { return false; }
}
function askHidden(prompt) {
  if (!process.stdin.isTTY) fail("A terminal is required for masked password entry.");
  return new Promise((resolve) => {
    let value = "";
    process.stdout.write(prompt);
    process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding("utf8");
    const onData = (key) => {
      if (key === "\r" || key === "\n") { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off("data", onData); process.stdout.write("\n"); resolve(value); }
      else if (key === "\u0003") { process.stdin.setRawMode(false); process.exit(130); }
      else if (key === "\u007f") { if (value) value = value.slice(0, -1); }
      else value += key;
    };
    process.stdin.on("data", onData);
  });
}
async function waitForMysql(options, attempts = 60) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { const connection = await mysql.createConnection(options); await connection.query("select 1"); return connection; }
    catch { if (attempt === attempts) break; await new Promise((resolve) => setTimeout(resolve, 1000)); }
  }
  throw new Error("MySQL did not become ready within 60 seconds.");
}
function saveApplicationEnv(url, testUrl) {
  const current = existsSync(".env.local") ? readFileSync(".env.local", "utf8") : "";
  const lines = current.split(/\r?\n/).filter((line) => !/^\s*(MYSQL_URL|MYSQL_TEST_URL|DATABASE_URL)\s*=/.test(line));
  writeFileSync(".env.local", [`MYSQL_URL=${url}`, `MYSQL_TEST_URL=${testUrl}`, ...lines].join("\n").replace(/\n+$/, "\n"), { mode: 0o600 });
  chmodSync(".env.local", 0o600);
  process.env.MYSQL_URL = url;
  process.env.MYSQL_TEST_URL = testUrl;
}
async function provisionWithRoot(root, appPassword, host, port) {
  await root.query(`create database if not exists \`${DATABASE}\` character set utf8mb4 collate utf8mb4_0900_ai_ci`);
  await root.query(`create database if not exists \`${TEST_DATABASE}\` character set utf8mb4 collate utf8mb4_0900_ai_ci`);
  for (const accountHost of host === "127.0.0.1" && port === CONTAINER_PORT ? ["%"] : ["localhost", "127.0.0.1"]) {
    await root.query(mysql.format("create user if not exists ?@? identified by ?", [USER, accountHost, appPassword]));
    await root.query(mysql.format("alter user ?@? identified by ?", [USER, accountHost, appPassword]));
    await root.query(mysql.format(`grant all privileges on \`${DATABASE}\`.* to ?@?`, [USER, accountHost]));
    await root.query(mysql.format(`grant all privileges on \`${TEST_DATABASE}\`.* to ?@?`, [USER, accountHost]));
  }
  const credentials = `${encodeURIComponent(USER)}:${encodeURIComponent(appPassword)}`;
  saveApplicationEnv(`mysql://${credentials}@${host}:${port}/${DATABASE}`, `mysql://${credentials}@${host}:${port}/${TEST_DATABASE}`);
}

async function setupDocker(docker) {
  mkdirSync(".local-data", { recursive: true, mode: 0o700 });
  let rootPassword;
  let appPassword;
  if (existsSync(CONTAINER_ENV)) {
    const values = Object.fromEntries(readFileSync(CONTAINER_ENV, "utf8").split(/\r?\n/).filter(Boolean).map((line) => line.split(/=(.*)/s, 2)));
    rootPassword = values.MYSQL_ROOT_PASSWORD;
    appPassword = values.MYSQL_PASSWORD;
    if (!rootPassword || !appPassword) fail(`${CONTAINER_ENV} is incomplete. Remove the local container and this file, then rerun setup.`);
  } else {
    rootPassword = randomBytes(24).toString("base64url");
    appPassword = randomBytes(24).toString("base64url");
    writeFileSync(CONTAINER_ENV, `MYSQL_ROOT_PASSWORD=${rootPassword}\nMYSQL_DATABASE=${DATABASE}\nMYSQL_USER=${USER}\nMYSQL_PASSWORD=${appPassword}\n`, { mode: 0o600 });
    chmodSync(CONTAINER_ENV, 0o600);
  }

  const inspected = spawnSync(docker, ["inspect", CONTAINER], { stdio: "ignore" });
  if (inspected.status === 0) {
    if (run(docker, ["start", CONTAINER]).status !== 0) fail("The existing local MySQL container could not be started.");
  } else {
    console.log("\nStarting a private MySQL 8 container (the first image download can take a minute)…");
    const created = run(docker, ["run", "--detach", "--name", CONTAINER, "--env-file", CONTAINER_ENV, "--publish", `127.0.0.1:${CONTAINER_PORT}:3306`, "--volume", `${CONTAINER}:/var/lib/mysql`, "mysql:8.4"]);
    if (created.status !== 0) fail(`Docker could not start MySQL. Make sure port ${CONTAINER_PORT} is free, then rerun setup.`);
  }

  let root;
  try { root = await waitForMysql({ host: "127.0.0.1", port: CONTAINER_PORT, user: "root", password: rootPassword, database: "mysql" }); }
  catch (error) { fail(error instanceof Error ? error.message : String(error)); }
  try { await provisionWithRoot(root, appPassword, "127.0.0.1", CONTAINER_PORT); }
  finally { await root.end(); }
  console.log("Docker MySQL is configured with persistent local storage.");
}

async function setupNative() {
  if (!command("mysql")) {
    const instructions = process.platform === "darwin"
      ? "Install Docker Desktop, or run `brew install mysql && brew services start mysql`, then rerun this command."
      : process.platform === "win32"
        ? "Install and start Docker Desktop (recommended), or install MySQL 8 using MySQL Installer, then rerun this command."
        : "Install/start Docker Engine (recommended), or install the MySQL 8 server from your Linux distribution, then rerun this command.";
    fail(`No running database option was found. ${instructions}`);
  }
  if (command("mysqladmin") && spawnSync("mysqladmin", ["ping", "--silent"], { stdio: "ignore" }).status !== 0) {
    const start = process.platform === "darwin" ? "brew services start mysql" : process.platform === "win32" ? "Start the MySQL80 service" : "sudo systemctl enable --now mysql";
    fail(`MySQL is installed but not running. Run: ${start}\nThen rerun npm run setup:local.`);
  }
  let root;
  try { root = await mysql.createConnection({ host: "127.0.0.1", user: "root", database: "mysql" }); }
  catch {
    const password = await askHidden("Local MySQL root password (masked): ");
    try { root = await mysql.createConnection({ host: "127.0.0.1", user: "root", password, database: "mysql" }); }
    catch (error) { fail(`Could not connect as local MySQL root: ${error instanceof Error ? error.message : String(error)}`); }
  }
  const appPassword = randomBytes(24).toString("base64url");
  try { await provisionWithRoot(root, appPassword, "127.0.0.1", 3306); }
  finally { await root.end(); }
  console.log("Native MySQL is configured.");
}

loadEnvFile();
if (await canConnect(process.env.MYSQL_URL)) console.log("\nReusing the working MySQL database in .env.local.");
else {
  const docker = command("docker") || command("podman");
  if (docker) await setupDocker(docker);
  else await setupNative();
}

console.log("Initializing the schema and starter catalog…");
const initialized = run(process.execPath, ["--env-file=.env.local", "scripts/init-db.mjs"]);
if (initialized.status !== 0) process.exit(initialized.status ?? 1);

let ownerEmail = process.argv[2] ?? "";
if (!ownerEmail && process.stdin.isTTY) {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  ownerEmail = (await prompt.question("Owner email (leave blank to skip): ")).trim();
  prompt.close();
}
if (ownerEmail) {
  const owner = run(process.execPath, ["scripts/create-owner.mjs", ownerEmail]);
  if (owner.status !== 0) process.exit(owner.status ?? 1);
}
console.log("\nSetup complete. Start the app with: npm run dev:local\n");
