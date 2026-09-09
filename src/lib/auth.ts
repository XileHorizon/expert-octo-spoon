import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { isDatabaseConfigured, queryOne, query, transaction } from "./db";

export const SESSION_COOKIE = "spe_owner_session";
const SESSION_TTL_HOURS = Number(process.env.SESSION_TTL_HOURS ?? 12);
const RESET_TTL_MINUTES = Number(process.env.PASSWORD_RESET_TTL_MINUTES ?? 60);
const BCRYPT_ROUNDS = 12;

export const MIN_PASSWORD_LENGTH = 12;

export type OwnerRow = { id: string; email: string; password_hash: string; active: boolean };

/** Tokens are stored only as SHA-256 hashes so a database leak cannot yield usable sessions. */
function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function newToken() {
  return randomBytes(32).toString("base64url");
}

export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password)) return "Use both uppercase and lowercase letters.";
  if (!/[0-9]/.test(password)) return "Include at least one number.";
  return null;
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function createSession(ownerId: string) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000);
  await query("insert into owner_sessions(token_hash, owner_id, expires_at) values (?,?,?)", [hashToken(token), ownerId, expiresAt]);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.SESSION_COOKIE_SECURE === "false" ? false : process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
  return { token, expiresAt };
}

export async function destroyCurrentSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await query("delete from owner_sessions where token_hash = ?", [hashToken(token)]);
  store.delete(SESSION_COOKIE);
}

type AuthResult =
  | { ok: true; owner: { id: string; email: string } }
  | { ok: false; status: 401 | 403 | 503; error: string };

/** Single authorization gate for every owner page and API route. */
export async function requireApprovedOwner(): Promise<AuthResult> {
  if (!isDatabaseConfigured()) return { ok: false, status: 503, error: "The database is not configured yet." };
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return { ok: false, status: 401, error: "Authentication required." };

  const row = await queryOne<{ id: string; email: string; active: boolean; expires_at: Date }>(
    `select o.id, o.email, o.active, s.expires_at
       from owner_sessions s
       join owners o on o.id = s.owner_id
      where s.token_hash = ?`,
    [hashToken(token)],
  ).catch(() => "DB_ERROR" as const);

  if (row === "DB_ERROR") return { ok: false, status: 503, error: "The database is unavailable. Try again shortly." };
  if (!row) return { ok: false, status: 401, error: "Authentication required." };
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await query("delete from owner_sessions where token_hash = ?", [hashToken(token)]).catch(() => null);
    return { ok: false, status: 401, error: "Your session expired. Sign in again." };
  }
  if (!row.active) return { ok: false, status: 403, error: "This owner account is disabled." };
  return { ok: true, owner: { id: row.id, email: row.email } };
}

export async function findOwnerByEmail(email: string) {
  return queryOne<OwnerRow>("select id, email, password_hash, active from owners where email = ?", [email]);
}

export async function firstOwnerSetupAvailable() {
  if (!isDatabaseConfigured()) return false;
  const row = await queryOne<{ completed_at: Date | null; owner_count: number }>(
    `select s.completed_at, (select count(*) from owners) as owner_count
       from owner_setup_state s where s.id=1`,
  );
  return Boolean(row && !row.completed_at && Number(row.owner_count) === 0);
}

/** Transactionally creates the only bootstrap owner and permanently closes setup. */
export async function createFirstOwner(email: string, password: string) {
  const passwordHash = await hashPassword(password);
  return transaction(async (client) => {
    const state = await client.query<{ completed_at: Date | null }>("select completed_at from owner_setup_state where id=1 for update");
    if (!state.rows[0]) throw new Error("Owner setup state is missing. Re-run database initialization.");
    const owners = await client.query<{ id: string }>("select id from owners order by created_at limit 1");
    if (state.rows[0].completed_at || owners.rows.length) {
      if (!state.rows[0].completed_at && owners.rows[0]) {
        await client.query("update owner_setup_state set completed_at=utc_timestamp(3),owner_id=? where id=1", [owners.rows[0].id]);
      }
      return { ok: false as const, reason: "closed" as const };
    }
    const ownerId = randomUUID();
    await client.query("insert into owners(id,email,password_hash,active) values (?,?,?,true)", [ownerId, email, passwordHash]);
    await client.query("update owner_setup_state set completed_at=utc_timestamp(3),owner_id=? where id=1", [ownerId]);
    return { ok: true as const, ownerId };
  });
}

/** Returns the raw reset token; only its hash is stored. */
export async function createPasswordReset(ownerId: string) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + RESET_TTL_MINUTES * 60 * 1000);
  await transaction(async (client) => {
    await client.query("delete from owner_password_resets where owner_id = ? and used_at is null", [ownerId]);
    await client.query("insert into owner_password_resets(token_hash, owner_id, expires_at) values (?,?,?)", [hashToken(token), ownerId, expiresAt]);
  });
  return { token, expiresAt, ttlMinutes: RESET_TTL_MINUTES };
}

export async function consumePasswordReset(token: string, newPassword: string) {
  const hash = await hashPassword(newPassword);
  const tokenHash = hashToken(token);
  return transaction(async (client) => {
    const result = await client.query<{ owner_id: string; expires_at: Date; used_at: Date | null }>(
      "select owner_id, expires_at, used_at from owner_password_resets where token_hash = ? for update",
      [tokenHash],
    );
    const row = result.rows[0];
    if (!row || row.used_at) return { ok: false as const, error: "This reset link is no longer valid. Request a new one." };
    if (new Date(row.expires_at).getTime() <= Date.now()) return { ok: false as const, error: "This reset link expired. Request a new one." };

    await client.query("update owners set password_hash = ? where id = ?", [hash, row.owner_id]);
    await client.query("update owner_password_resets set used_at = utc_timestamp(3) where token_hash = ?", [tokenHash]);
    // Force re-authentication everywhere after a password change.
    await client.query("delete from owner_sessions where owner_id = ?", [row.owner_id]);
    return { ok: true as const, ownerId: row.owner_id };
  });
}

/** Constant-time compare helper that does not reveal the configured secret length. */
export function safeEquals(a: string, b: string) {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}

export async function purgeExpiredAuthRecords() {
  await query("delete from owner_sessions where expires_at < utc_timestamp(3)");
  await query("delete from owner_password_resets where expires_at < utc_timestamp(3) and used_at is null");
}
