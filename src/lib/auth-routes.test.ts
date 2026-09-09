import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createFirstOwner: vi.fn(), firstOwnerSetupAvailable: vi.fn(), passwordProblem: vi.fn(), safeEquals: vi.fn(),
  firstRunSetupAvailable: vi.fn(), prepareFirstRunDatabase: vi.fn(),
  enqueuePasswordResetDelivery: vi.fn(), processPasswordResetDeliveryQueue: vi.fn(),
  afterCallbacks: [] as Array<() => Promise<unknown> | unknown>,
}));

vi.mock("next/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/server")>(),
  after: (callback: () => Promise<unknown> | unknown) => { mocks.afterCallbacks.push(callback); },
}));
vi.mock("@/lib/db", () => ({ isDatabaseConfigured: () => true }));
vi.mock("@/lib/first-run-bootstrap", () => ({
  firstRunSetupAvailable: mocks.firstRunSetupAvailable,
  prepareFirstRunDatabase: mocks.prepareFirstRunDatabase,
  UnsafeFirstRunDatabaseError: class UnsafeFirstRunDatabaseError extends Error {},
}));
vi.mock("@/lib/auth", () => ({
  createFirstOwner: mocks.createFirstOwner,
  firstOwnerSetupAvailable: mocks.firstOwnerSetupAvailable,
  passwordProblem: mocks.passwordProblem,
  safeEquals: mocks.safeEquals,
}));
vi.mock("@/lib/password-reset-delivery", () => ({
  enqueuePasswordResetDelivery: mocks.enqueuePasswordResetDelivery,
  processPasswordResetDeliveryQueue: mocks.processPasswordResetDeliveryQueue,
}));

import { GET as setupStatus, POST as setupOwner } from "@/app/api/auth/setup/route";
import { POST as requestReset, validatedAppOrigin } from "@/app/api/auth/request-reset/route";
import { POST as recoverResetDeliveries } from "@/app/api/internal/password-reset-deliveries/route";

const originalEnv = { ...process.env };
const jsonRequest = (url: string, body: unknown) => new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("first owner setup route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FIRST_OWNER_SETUP_SECRET = "deployment-secret-that-is-at-least-32-characters";
    mocks.firstRunSetupAvailable.mockResolvedValue(true);
    mocks.prepareFirstRunDatabase.mockResolvedValue({ initialized: false });
    mocks.firstOwnerSetupAvailable.mockResolvedValue(true);
    mocks.safeEquals.mockImplementation((a: string, b: string) => a === b);
    mocks.passwordProblem.mockReturnValue(null);
    mocks.createFirstOwner.mockResolvedValue({ ok: true, ownerId: "owner-1" });
  });
  afterEach(() => { process.env = { ...originalEnv }; });

  it("reports setup availability without exposing the deployment secret", async () => {
    const response = await setupStatus();
    expect(await response.json()).toEqual({ available: true });
    expect(JSON.stringify(await setupStatus().then((item) => item.json()))).not.toContain(process.env.FIRST_OWNER_SETUP_SECRET);
  });

  it("requires the deployment secret in the masked form body and never creates on mismatch", async () => {
    const response = await setupOwner(jsonRequest("https://quotes.example.test/api/auth/setup", { email: "owner@example.test", password: "CorrectHorse9Battery", setupSecret: "wrong" }));
    expect(response.status).toBe(403);
    expect(mocks.createFirstOwner).not.toHaveBeenCalled();
    expect(mocks.prepareFirstRunDatabase).not.toHaveBeenCalled();
  });

  it("creates once and permanently refuses when setup state is closed", async () => {
    const body = { email: "owner@example.test", password: "CorrectHorse9Battery", setupSecret: process.env.FIRST_OWNER_SETUP_SECRET };
    expect((await setupOwner(jsonRequest("https://quotes.example.test/api/auth/setup", body))).status).toBe(201);
    expect(mocks.prepareFirstRunDatabase).toHaveBeenCalledTimes(1);
    mocks.createFirstOwner.mockResolvedValueOnce({ ok: false, reason: "closed" });
    expect((await setupOwner(jsonRequest("https://quotes.example.test/api/auth/setup", body))).status).toBe(409);
  });
});

describe("owner recovery route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_URL = "https://quotes.production.example";
    process.env.PASSWORD_RESET_RESPONSE_FLOOR_MS = "250";
    mocks.afterCallbacks.splice(0);
    mocks.enqueuePasswordResetDelivery.mockResolvedValue(true);
    mocks.processPasswordResetDeliveryQueue.mockResolvedValue(1);
  });
  afterEach(() => { vi.unstubAllEnvs(); process.env = { ...originalEnv }; });

  it("queues a known owner and runs delivery only after the response", async () => {
    const response = await requestReset(jsonRequest("https://internal-host/api/auth/request-reset", { email: "owner@example.test" }));
    expect(response.status).toBe(200);
    expect(mocks.enqueuePasswordResetDelivery).toHaveBeenCalledWith("owner@example.test");
    expect(mocks.processPasswordResetDeliveryQueue).not.toHaveBeenCalled();
    expect(mocks.afterCallbacks).toHaveLength(1);
    await mocks.afterCallbacks[0]();
    expect(mocks.processPasswordResetDeliveryQueue).toHaveBeenCalledWith("https://quotes.production.example", 1);
  });

  it("returns the same neutral response for known and unknown accounts", async () => {
    const known = await requestReset(jsonRequest("https://example.test/api/auth/request-reset", { email: "owner@example.test" }));
    mocks.enqueuePasswordResetDelivery.mockResolvedValueOnce(false);
    const unknown = await requestReset(jsonRequest("https://example.test/api/auth/request-reset", { email: "unknown@example.test" }));
    expect(unknown.status).toBe(known.status);
    expect(await unknown.json()).toEqual(await known.json());
    expect(mocks.afterCallbacks).toHaveLength(1);
  });

  it.each([100, 600])("keeps the response independent of a %ims provider delay and eventually delivers", async (providerDelay) => {
    let delivered = false;
    mocks.processPasswordResetDeliveryQueue.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, providerDelay));
      delivered = true;
      return 1;
    });
    const start = performance.now();
    const response = await requestReset(jsonRequest("https://example.test/api/auth/request-reset", { email: "owner@example.test" }));
    const duration = performance.now() - start;

    expect(response.status).toBe(200);
    expect(duration).toBeGreaterThanOrEqual(225);
    expect(duration).toBeLessThan(500);
    expect(delivered).toBe(false);
    await mocks.afterCallbacks[0]();
    expect(delivered).toBe(true);
  });

  it("creates no queued job or background delivery for an unknown account", async () => {
    mocks.enqueuePasswordResetDelivery.mockResolvedValueOnce(false);
    const response = await requestReset(jsonRequest("https://example.test/api/auth/request-reset", { email: "unknown@example.test" }));
    expect(response.status).toBe(200);
    expect(mocks.enqueuePasswordResetDelivery).toHaveBeenCalledTimes(1);
    expect(mocks.afterCallbacks).toEqual([]);
    expect(mocks.processPasswordResetDeliveryQueue).not.toHaveBeenCalled();
  });

  it.each([
    ["relative URL", "/quotes"],
    ["production HTTP", "http://quotes.production.example"],
    ["credentials", "https://user:secret@quotes.production.example"],
    ["path", "https://quotes.production.example/app"],
    ["query", "https://quotes.production.example?tenant=one"],
    ["fragment", "https://quotes.production.example#reset"],
    ["non-HTTP protocol", "javascript:alert(1)"],
  ])("rejects an unsafe APP_URL with %s before creating a reset", async (_label, appUrl) => {
    process.env.APP_URL = appUrl;
    vi.stubEnv("NODE_ENV", "production");
    const response = await requestReset(jsonRequest("https://example.test/api/auth/request-reset", { email: "owner@example.test" }));

    expect(response.status).toBe(503);
    expect(mocks.enqueuePasswordResetDelivery).not.toHaveBeenCalled();
    expect(mocks.processPasswordResetDeliveryQueue).not.toHaveBeenCalled();
  });

  it("normalizes safe origins and allows HTTP only for non-production loopback verification", () => {
    expect(validatedAppOrigin("https://quotes.production.example:443/", true)).toBe("https://quotes.production.example");
    expect(validatedAppOrigin("http://127.0.0.1:35000/", false)).toBe("http://127.0.0.1:35000");
    expect(validatedAppOrigin("http://quotes.production.example/", false)).toBeNull();
    expect(validatedAppOrigin("http://127.0.0.1:35000/", true)).toBeNull();
  });
});

describe("durable reset delivery recovery route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_URL = "https://quotes.production.example";
    process.env.RESET_DELIVERY_WORKER_SECRET = "worker-secret-that-is-at-least-32-characters";
    mocks.safeEquals.mockImplementation((a: string, b: string) => a === b);
    mocks.processPasswordResetDeliveryQueue.mockResolvedValue(2);
  });
  afterEach(() => { process.env = { ...originalEnv }; });

  it("rejects an unauthenticated recovery run", async () => {
    const response = await recoverResetDeliveries(new Request("https://quotes.production.example/api/internal/password-reset-deliveries", { method: "POST" }));
    expect(response.status).toBe(401);
    expect(mocks.processPasswordResetDeliveryQueue).not.toHaveBeenCalled();
  });

  it("lets the scheduled recovery path drain durable queued work", async () => {
    const response = await recoverResetDeliveries(new Request("https://quotes.production.example/api/internal/password-reset-deliveries", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.RESET_DELIVERY_WORKER_SECRET}` },
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, processed: 2 });
    expect(mocks.processPasswordResetDeliveryQueue).toHaveBeenCalledWith("https://quotes.production.example", 10);
  });
});
