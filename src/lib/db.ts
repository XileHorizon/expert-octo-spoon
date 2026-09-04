import { Pool, type QueryResultRow } from "pg";

/**
 * Portable PostgreSQL access. Works against any PostgreSQL 14+ instance
 * (managed or self-hosted) through a standard DATABASE_URL connection string.
 */

declare global {
  var __shipPrintPool: Pool | undefined;
}

export function getPool(): Pool | null {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;
  if (!globalThis.__shipPrintPool) {
    globalThis.__shipPrintPool = new Pool({
      connectionString,
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
    });
  }
  return globalThis.__shipPrintPool;
}

export function isDatabaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

export async function query<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) {
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL is not configured.");
  return pool.query<T>(text, params);
}

export async function queryRows<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) {
  return (await query<T>(text, params)).rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) {
  return (await query<T>(text, params)).rows[0] ?? null;
}

/** Runs a set of statements in a single transaction, rolling back on any error. */
export async function transaction<T>(handler: (client: import("pg").PoolClient) => Promise<T>): Promise<T> {
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL is not configured.");
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await handler(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
