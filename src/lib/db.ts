import mysql, { type Pool, type PoolConnection, type ResultSetHeader } from "mysql2/promise";

type DatabaseRow = Record<string, unknown>;
export type QueryResult<T extends DatabaseRow = DatabaseRow> = {
  rows: T[];
  rowCount: number;
  affectedRows: number;
  insertId: number;
};

export type DatabaseClient = { query<T extends DatabaseRow = DatabaseRow>(sql: string, params?: unknown[]): Promise<QueryResult<T>> };

declare global { var __shipPrintPool: Pool | undefined; }

function databaseConfig() {
  const uri = process.env.MYSQL_URL;
  if (!uri) return null;
  return {
    uri,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  };
}

export function getPool(): Pool | null {
  const config = databaseConfig();
  if (!config) return null;
  if (!globalThis.__shipPrintPool) {
    globalThis.__shipPrintPool = mysql.createPool({
      uri: config.uri,
      connectionLimit: config.max,
      waitForConnections: true,
      queueLimit: 0,
      connectTimeout: 10_000,
      timezone: "Z",
      dateStrings: false,
      ssl: config.ssl,
      decimalNumbers: false,
      typeCast(field, next) {
        if (field.type === "TINY" && field.length === 1) return field.string() === "1";
        return next();
      },
    });
  }
  return globalThis.__shipPrintPool;
}

export function isDatabaseConfigured() { return Boolean(process.env.MYSQL_URL); }

function normalize<T extends DatabaseRow>(value: unknown): QueryResult<T> {
  if (Array.isArray(value)) return { rows: value as T[], rowCount: value.length, affectedRows: 0, insertId: 0 };
  const result = value as ResultSetHeader;
  return { rows: [], rowCount: result.affectedRows, affectedRows: result.affectedRows, insertId: result.insertId };
}

type ExecuteParams = NonNullable<Parameters<PoolConnection["execute"]>[1]>;

async function execute<T extends DatabaseRow>(executor: Pool | PoolConnection, sql: string, params: unknown[] = []) {
  const [result] = await executor.execute(sql, params as ExecuteParams);
  return normalize<T>(result);
}

export async function query<T extends DatabaseRow = DatabaseRow>(sql: string, params: unknown[] = []) {
  const pool = getPool();
  if (!pool) throw new Error("MYSQL_URL is not configured.");
  return execute<T>(pool, sql, params);
}

export async function queryRows<T extends DatabaseRow = DatabaseRow>(sql: string, params: unknown[] = []) {
  return (await query<T>(sql, params)).rows;
}

export async function queryOne<T extends DatabaseRow = DatabaseRow>(sql: string, params: unknown[] = []) {
  return (await query<T>(sql, params)).rows[0] ?? null;
}

export async function transaction<T>(handler: (client: DatabaseClient) => Promise<T>): Promise<T> {
  const pool = getPool();
  if (!pool) throw new Error("MYSQL_URL is not configured.");
  const connection = await pool.getConnection();
  const client: DatabaseClient = { query: (sql, params = []) => execute(connection, sql, params) };
  try {
    await connection.beginTransaction();
    const result = await handler(client);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
