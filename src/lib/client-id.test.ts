import { describe, expect, it, vi } from "vitest";
import { createClientUuid } from "./client-id";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("createClientUuid", () => {
  it("uses randomUUID when the browser provides it", () => {
    const randomUUID = vi.fn(() => "123e4567-e89b-42d3-a456-426614174000");
    expect(createClientUuid({ randomUUID })).toBe("123e4567-e89b-42d3-a456-426614174000");
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it("creates a valid v4 UUID when randomUUID is unavailable on LAN HTTP", () => {
    const getRandomValues = (bytes: Uint8Array) => {
      bytes.forEach((_, index) => { bytes[index] = index; });
      return bytes;
    };
    expect(createClientUuid({ getRandomValues })).toMatch(UUID_V4);
  });

  it("still creates a valid id when Web Crypto is entirely unavailable", () => {
    expect(createClientUuid(null)).toMatch(UUID_V4);
  });
});
