import { describe, expect, it } from "vitest";
import { databaseConfigurationProblem, databaseConnectionOptions } from "./database-config";

describe("database configuration", () => {
  it("prefers MYSQL_URL and preserves the runtime connection policy", () => {
    const options = databaseConnectionOptions({
      MYSQL_URL: "mysql://local:secret@127.0.0.1:3306/local_db",
      DB_HOST: "ignored.example",
      DATABASE_SSL: "true",
      DATABASE_POOL_MAX: "7",
    }, { pool: true });

    expect(options).toMatchObject({
      uri: "mysql://local:secret@127.0.0.1:3306/local_db",
      charset: "utf8mb4",
      timezone: "Z",
      connectionLimit: 7,
      waitForConnections: true,
      queueLimit: 0,
      ssl: { rejectUnauthorized: false },
    });
    expect(options).not.toHaveProperty("host");
  });

  it("builds a GoDaddy component configuration with the default port", () => {
    const options = databaseConnectionOptions({
      DB_HOST: "localhost",
      DB_USER: "account_app",
      DB_PASSWORD: "not-logged",
      DB_NAME: "account_shipprintsell",
    });

    expect(options).toMatchObject({
      host: "localhost",
      port: 3306,
      user: "account_app",
      password: "not-logged",
      database: "account_shipprintsell",
      charset: "utf8mb4",
      timezone: "Z",
    });
    expect(options).not.toHaveProperty("multipleStatements");
  });

  it("enables multiple statements only for intentional initialization callers", () => {
    const env = { DB_HOST: "localhost", DB_USER: "app", DB_PASSWORD: "secret", DB_NAME: "app" };
    expect(databaseConnectionOptions(env)).not.toHaveProperty("multipleStatements");
    expect(databaseConnectionOptions(env, { multipleStatements: true })).toHaveProperty("multipleStatements", true);
  });

  it("returns null only when neither configuration form is present", () => {
    expect(databaseConnectionOptions({})).toBeNull();
  });

  it("rejects partial component configuration without printing configured values", () => {
    const problem = databaseConfigurationProblem({ DB_HOST: "private-db.example", DB_PASSWORD: "super-secret" });
    expect(problem).toContain("DB_USER");
    expect(problem).toContain("DB_NAME");
    expect(problem).not.toContain("private-db.example");
    expect(problem).not.toContain("super-secret");
  });

  it.each(["0", "65536", "3306.5", "not-a-port"])("rejects invalid DB_PORT %s", (DB_PORT) => {
    expect(() => databaseConnectionOptions({
      DB_HOST: "localhost", DB_USER: "app", DB_PASSWORD: "secret", DB_NAME: "app", DB_PORT,
    })).toThrow("DB_PORT must be an integer between 1 and 65535");
  });
});
