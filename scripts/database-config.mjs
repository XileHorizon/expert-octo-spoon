const REQUIRED_COMPONENT_KEYS = ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"];

function configured(value) {
  return value !== undefined && value.length > 0;
}

function port(raw) {
  if (!configured(raw)) return 3306;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) throw new Error("DB_PORT must be an integer between 1 and 65535.");
  return value;
}

export function databaseConnectionOptions(env = process.env, extra = {}) {
  let credentials;
  if (configured(env.MYSQL_URL)) {
    credentials = { uri: env.MYSQL_URL };
  } else {
    const present = REQUIRED_COMPONENT_KEYS.filter((key) => configured(env[key]));
    if (present.length === 0 && !configured(env.DB_PORT)) return null;
    const missing = REQUIRED_COMPONENT_KEYS.filter((key) => !configured(env[key]));
    if (missing.length > 0) {
      throw new Error(`Incomplete database configuration. Set MYSQL_URL, or provide DB_HOST, DB_USER, DB_PASSWORD, and DB_NAME. Missing: ${missing.join(", ")}.`);
    }
    credentials = {
      host: env.DB_HOST,
      port: port(env.DB_PORT),
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      database: env.DB_NAME,
    };
  }
  return {
    ...credentials,
    charset: "utf8mb4",
    timezone: "Z",
    connectTimeout: 10_000,
    ssl: env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
    ...extra,
  };
}

export function databaseCliIdentity(env = process.env) {
  if (configured(env.MYSQL_URL)) {
    let url;
    try { url = new URL(env.MYSQL_URL); } catch { throw new Error("MYSQL_URL is not a valid URL."); }
    if (url.protocol !== "mysql:") throw new Error("MYSQL_URL must use mysql://.");
    const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
    if (!database) throw new Error("MYSQL_URL must include a database name.");
    return {
      host: url.hostname,
      port: url.port || "3306",
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database,
    };
  }
  const options = databaseConnectionOptions(env);
  if (!options) return null;
  return {
    host: options.host,
    port: String(options.port),
    user: options.user,
    password: options.password,
    database: options.database,
  };
}
