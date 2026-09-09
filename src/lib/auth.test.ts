import { describe, expect, it } from "vitest";
import { hashPassword, passwordProblem, safeEquals, verifyPassword } from "./auth";

describe("password policy", () => {
  it("rejects passwords that are too short", () => {
    expect(passwordProblem("Abc12345")).toContain("at least 12");
  });

  it("requires mixed case and a number", () => {
    expect(passwordProblem("alllowercase123")).toContain("uppercase");
    expect(passwordProblem("NoNumbersHereAtAll")).toContain("number");
  });

  it("accepts a compliant password", () => {
    expect(passwordProblem("CorrectHorse9Battery")).toBeNull();
  });
});

describe("password hashing", () => {
  it("verifies a correct password and rejects a wrong one", async () => {
    const hash = await hashPassword("CorrectHorse9Battery");
    expect(hash).not.toContain("CorrectHorse9Battery");
    expect(await verifyPassword("CorrectHorse9Battery", hash)).toBe(true);
    expect(await verifyPassword("WrongHorse9Battery", hash)).toBe(false);
  }, 15_000);

  it("produces a different hash each time for the same password", async () => {
    const [first, second] = await Promise.all([hashPassword("CorrectHorse9Battery"), hashPassword("CorrectHorse9Battery")]);
    expect(first).not.toBe(second);
  });
});

describe("safeEquals", () => {
  it("compares equal and unequal values without throwing on length mismatch", () => {
    expect(safeEquals("abc123", "abc123")).toBe(true);
    expect(safeEquals("abc123", "abc124")).toBe(false);
    expect(safeEquals("short", "muchlongervalue")).toBe(false);
  });
});
