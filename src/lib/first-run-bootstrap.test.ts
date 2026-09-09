import { describe, expect, it } from "vitest";
import { classifyFirstRunTables, EXPECTED_APPLICATION_TABLES } from "./first-run-bootstrap";

describe("first-run database classification", () => {
  it("permits initialization only for a completely empty database", () => {
    expect(classifyFirstRunTables([])).toBe("empty");
  });

  it("recognizes the complete application schema regardless of table order", () => {
    expect(classifyFirstRunTables([...EXPECTED_APPLICATION_TABLES].reverse())).toBe("ready");
  });

  it.each([
    ["partial application schema", EXPECTED_APPLICATION_TABLES.slice(0, -1)],
    ["unknown table mixed into the schema", [...EXPECTED_APPLICATION_TABLES, "customer_backup"]],
    ["unrelated populated database", ["wordpress_posts"]],
  ])("refuses an existing %s", (_label, tables) => {
    expect(classifyFirstRunTables([...tables])).toBe("unsafe");
  });
});
