import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  requireEnv: vi.fn(() => "https://example.upstash.io"),
  env: {
    UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
    UPSTASH_REDIS_REST_TOKEN: "tok",
  } as Record<string, unknown>,
}));

const redisMock = {
  set: vi.fn(),
  get: vi.fn(),
};
vi.mock("@/lib/kv", () => ({
  getKv: () => redisMock,
}));

import { beginIdempotency, getIdempotencyKey } from "@/lib/idempotency";

describe("idempotency", () => {
  beforeEach(() => {
    redisMock.set.mockReset();
    redisMock.get.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getIdempotencyKey", () => {
    it("reads Idempotency-Key header", () => {
      const r = new Request("http://x", { headers: { "Idempotency-Key": "abcdefgh" } });
      expect(getIdempotencyKey(r)).toBe("abcdefgh");
    });
    it("reads X-Idempotency-Key fallback", () => {
      const r = new Request("http://x", { headers: { "X-Idempotency-Key": "abcdefgh" } });
      expect(getIdempotencyKey(r)).toBe("abcdefgh");
    });
    it("rejects too-short", () => {
      const r = new Request("http://x", { headers: { "Idempotency-Key": "abc" } });
      expect(getIdempotencyKey(r)).toBeNull();
    });
    it("rejects too-long", () => {
      const r = new Request("http://x", { headers: { "Idempotency-Key": "a".repeat(200) } });
      expect(getIdempotencyKey(r)).toBeNull();
    });
    it("rejects header smuggling chars", () => {
      const r = new Request("http://x", { headers: { "Idempotency-Key": "abc def gh" } });
      expect(getIdempotencyKey(r)).toBeNull();
    });
    it("returns null when no header is present", () => {
      const r = new Request("http://x");
      expect(getIdempotencyKey(r)).toBeNull();
    });
  });

  describe("beginIdempotency", () => {
    it("returns 'fresh' on first reservation and writes inflight token", async () => {
      redisMock.set.mockResolvedValueOnce("OK");
      const out = await beginIdempotency({
        scope: "tx-create",
        vendorId: "v1",
        idempotencyKey: "key-12345678",
      });
      expect(out.kind).toBe("fresh");
      expect(redisMock.set).toHaveBeenCalledTimes(1);
      const args = redisMock.set.mock.calls[0];
      expect(String(args[0])).toContain("idem:tx-create:v1:");
      expect(args[1]).toBe("__inflight__");
      // @upstash/redis options object: { nx: true, px: 30_000 }
      expect(args[2]).toEqual({ nx: true, px: 30_000 });
    });

    it("commit() writes the cached response with the long TTL", async () => {
      redisMock.set.mockResolvedValueOnce("OK");
      const out = await beginIdempotency({
        scope: "tx-create",
        vendorId: "v1",
        idempotencyKey: "key-12345678",
      });
      if (out.kind !== "fresh") throw new Error("expected fresh");
      redisMock.set.mockResolvedValueOnce("OK");
      await out.commit({ status: 201, body: { ok: true } });
      const callArgs = redisMock.set.mock.calls[1];
      expect(String(callArgs[1])).toContain('"status":201');
      expect(callArgs[2]).toEqual({ ex: 24 * 3600 });
    });

    it("returns 'replay' when the same key is replayed with a stored response", async () => {
      redisMock.set.mockResolvedValueOnce(null);
      redisMock.get.mockResolvedValueOnce(
        JSON.stringify({ status: 201, body: { id: "tx_123" } }),
      );
      const out = await beginIdempotency({
        scope: "tx-create",
        vendorId: "v1",
        idempotencyKey: "key-12345678",
      });
      expect(out.kind).toBe("replay");
      if (out.kind === "replay") {
        expect(out.record.status).toBe(201);
        expect(out.record.body).toEqual({ id: "tx_123" });
      }
    });

    it("returns 'in_flight' when reservation lost the race AND no stored body yet", async () => {
      redisMock.set.mockResolvedValueOnce(null);
      redisMock.get.mockResolvedValueOnce("__inflight__");
      const out = await beginIdempotency({
        scope: "tx-create",
        vendorId: "v1",
        idempotencyKey: "key-12345678",
      });
      expect(out.kind).toBe("in_flight");
    });

    it("returns 'disabled' on Redis outage (fail-open)", async () => {
      redisMock.set.mockRejectedValueOnce(new Error("ECONNREFUSED"));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const out = await beginIdempotency({
        scope: "tx-create",
        vendorId: "v1",
        idempotencyKey: "key-12345678",
      });
      expect(out.kind).toBe("disabled");
      warn.mockRestore();
    });

    it("isolates different vendors with the same key", async () => {
      redisMock.set.mockResolvedValue("OK");
      await beginIdempotency({ scope: "tx-create", vendorId: "v1", idempotencyKey: "key-12345678" });
      await beginIdempotency({ scope: "tx-create", vendorId: "v2", idempotencyKey: "key-12345678" });
      const k1 = String(redisMock.set.mock.calls[0][0]);
      const k2 = String(redisMock.set.mock.calls[1][0]);
      expect(k1).not.toBe(k2);
    });
  });
});
