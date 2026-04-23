import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  requireEnv: vi.fn(() => "redis://localhost:6379"),
  env: { REDIS_URL: "redis://localhost:6379" } as Record<string, unknown>,
}));

const mockEval = vi.fn();
vi.mock("@/lib/redis", () => ({
  getRedis: () => ({ eval: mockEval }),
}));

import {
  getClientIp,
  makeLimiter,
  tooManyRequests,
} from "@/lib/ratelimit";

describe("ratelimit", () => {
  beforeEach(() => {
    mockEval.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("makeLimiter", () => {
    it("allows when under the cap and exposes correct headers", async () => {
      mockEval.mockResolvedValueOnce([1, 4, 0]);
      const lim = makeLimiter({ name: "test", windowMs: 60_000, max: 5 });
      const r = await lim.check("user-1");
      expect(r.ok).toBe(true);
      expect(r.limit).toBe(5);
      expect(r.remaining).toBe(4);
      expect(r.resetAt).toBeGreaterThan(Date.now());
    });

    it("denies when over the cap and surfaces the reset time", async () => {
      const futureReset = Date.now() + 30_000;
      mockEval.mockResolvedValueOnce([0, 0, futureReset]);
      const lim = makeLimiter({ name: "test", windowMs: 60_000, max: 5 });
      const r = await lim.check("user-1");
      expect(r.ok).toBe(false);
      expect(r.remaining).toBe(0);
      expect(r.resetAt).toBe(futureReset);
    });

    it("fails OPEN on Redis error (never blocks legitimate users)", async () => {
      mockEval.mockRejectedValueOnce(new Error("ECONNREFUSED"));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const lim = makeLimiter({ name: "test", windowMs: 60_000, max: 5 });
      const r = await lim.check("user-1");
      expect(r.ok).toBe(true);
      expect(r.remaining).toBe(5);
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it("uses an isolated key per identifier", async () => {
      mockEval.mockResolvedValue([1, 4, 0]);
      const lim = makeLimiter({ name: "auth", windowMs: 60_000, max: 5 });
      await lim.check("alice");
      await lim.check("bob");
      const calls = mockEval.mock.calls;
      expect(calls[0][2]).toBe("rl:auth:alice");
      expect(calls[1][2]).toBe("rl:auth:bob");
    });
  });

  describe("getClientIp", () => {
    it("prefers the first entry in x-forwarded-for", () => {
      const req = new Request("http://x", {
        headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" },
      });
      expect(getClientIp(req)).toBe("203.0.113.5");
    });
    it("falls back to x-real-ip", () => {
      const req = new Request("http://x", {
        headers: { "x-real-ip": "203.0.113.7" },
      });
      expect(getClientIp(req)).toBe("203.0.113.7");
    });
    it('returns "unknown" when no headers are present', () => {
      const req = new Request("http://x");
      expect(getClientIp(req)).toBe("unknown");
    });
  });

  describe("tooManyRequests", () => {
    it("returns 429 with the standard rate-limit headers", async () => {
      const reset = Date.now() + 30_000;
      const r = tooManyRequests(
        { ok: false, limit: 5, remaining: 0, resetAt: reset },
        "auth",
      );
      expect(r.status).toBe(429);
      expect(r.headers.get("Retry-After")).toBeTruthy();
      expect(r.headers.get("X-RateLimit-Limit")).toBe("5");
      expect(r.headers.get("X-RateLimit-Remaining")).toBe("0");
      expect(r.headers.get("X-RateLimit-Reset")).toBeTruthy();
      const body = (await r.json()) as { error: string; scope: string };
      expect(body.error).toBe("rate_limited");
      expect(body.scope).toBe("auth");
    });
  });
});
