import type { ConnectionOptions, PoolOptions } from "mysql2";

const REQUIRED_COMPONENT_KEYS = ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"] as const;
type DatabaseEnvironment = Record<string, string | undefined>;

export class DatabaseConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseConfigurationError";
  }
}

function configured(value: string | undefined) {
  return value !== undefined && value.length > 0;
}

function databasePort(raw: string | undefined) {
  if (!configured(raw)) return 3306;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new DatabaseConfigurationError("DB_PORT must be an integer between 1 and 65535.");
  }
  return port;
}

function poolLimit(raw: string | undefined) {
  if (!configured(raw)) return 10;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new DatabaseConfigurationError("DATABASE_POOL_MAX must be a positive integer.");
  }
  return limit;
}

/**
 * Resolve the server-only MySQL configuration. MYSQL_URL deliberately wins so
 * local URL-based development remains compatible even when DB_* variables are
 * also present in the process environment.
 */
export function databaseConnectionOptions(
  env: DatabaseEnvironment = process.env,
  options: { multipleStatements?: boolean; pool?: boolean } = {},
): ConnectionOptions | PoolOptions | null {
  const mysqlUrl = env.MYSQL_URL;
  const shared = {
    charset: "utf8mb4",
    timezone: "Z",
    dateStrings: false,
    decimalNumbers: false,
    connectTimeout: 10_000,
    ssl: env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
    ...(options.multipleStatements ? { multipleStatements: true } : {}),
  } satisfies ConnectionOptions;

  let credentials: ConnectionOptions;
  if (configured(mysqlUrl)) {
    credentials = { uri: mysqlUrl };
  } else {
    const present = REQUIRED_COMPONENT_KEYS.filter((key) => configured(env[key]));
    if (present.length === 0 && !configured(env.DB_PORT)) return null;
    const missing = REQUIRED_COMPONENT_KEYS.filter((key) => !configured(env[key]));
    if (missing.length > 0) {
      throw new DatabaseConfigurationError(
        `Incomplete database configuration. Set MYSQL_URL, or provide DB_HOST, DB_USER, DB_PASSWORD, and DB_NAME. Missing: ${missing.join(", ")}.`,
      );
    }
    credentials = {
      host: env.DB_HOST,
      port: databasePort(env.DB_PORT),
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      database: env.DB_NAME,
    };
  }

  if (!options.pool) return { ...credentials, ...shared };
  return {
    ...credentials,
    ...shared,
    connectionLimit: poolLimit(env.DATABASE_POOL_MAX),
    waitForConnections: true,
    queueLimit: 0,
  } satisfies PoolOptions;
}

export function databaseConfigurationProblem(env: DatabaseEnvironment = process.env) {
  try {
    databaseConnectionOptions(env);
    return null;
  } catch (error) {
    return error instanceof DatabaseConfigurationError ? error.message : "Invalid database configuration.";
  }
}
