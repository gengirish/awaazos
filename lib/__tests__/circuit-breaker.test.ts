import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// In-memory KV stub. Vi.mock must be hoisted, so we declare the store
// at module level inside the factory and expose helpers via the mocked module.
vi.mock("@/lib/kv", () => {
  const store = new Map<string, { value: string; expiresAt: number | null }>();

  function now() {
    return Date.now();
  }

  function purge(key: string): boolean {
    const e = store.get(key);
    if (!e) return false;
    if (e.expiresAt !== null && e.expiresAt <= now()) {
      store.delete(key);
      return false;
    }
    return true;
  }

  const kv = {
    async get<T>(key: string): Promise<T | null> {
      if (!purge(key)) return null;
      return store.get(key)!.value as unknown as T;
    },
    async set(key: string, value: string, opts?: { ex?: number }) {
      const expiresAt = opts?.ex ? now() + opts.ex * 1000 : null;
      store.set(key, { value, expiresAt });
      return "OK";
    },
    async incr(key: string): Promise<number> {
      const cur = purge(key) ? Number(store.get(key)!.value) : 0;
      const next = cur + 1;
      store.set(key, {
        value: String(next),
        expiresAt: store.get(key)?.expiresAt ?? null,
      });
      return next;
    },
    async ttl(key: string): Promise<number> {
      if (!purge(key)) return -2;
      const e = store.get(key)!;
      if (e.expiresAt === null) return -1;
      return Math.max(0, Math.floor((e.expiresAt - now()) / 1000));
    },
    async expire(key: string, sec: number): Promise<number> {
      if (!purge(key)) return 0;
      const e = store.get(key)!;
      e.expiresAt = now() + sec * 1000;
      return 1;
    },
    async del(key: string): Promise<number> {
      const had = purge(key);
      store.delete(key);
      return had ? 1 : 0;
    },
  };

  return {
    getKv: () => kv,
    __setKvForTest: () => {},
    __resetKvStoreForTest: () => store.clear(),
  };
});

import { getBreaker } from "@/lib/circuit-breaker";
import * as kvMod from "@/lib/kv";

const NAME = "test-provider";

beforeEach(() => {
  // @ts-expect-error testing escape hatch
  kvMod.__resetKvStoreForTest();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("circuit-breaker", () => {
  it("starts CLOSED and allows requests", async () => {
    const b = getBreaker(NAME);
    await expect(b.allow()).resolves.toBe(true);
    await expect(b.getState()).resolves.toBe("closed");
  });

  it("does not trip on small samples (< minRequests)", async () => {
    const b = getBreaker(NAME, { minRequests: 10 });
    // 5 failures, 0 successes — only 5 samples, below minRequests.
    for (let i = 0; i < 5; i++) await b.recordFailure();
    await expect(b.allow()).resolves.toBe(true);
    await expect(b.getState()).resolves.toBe("closed");
  });

  it("opens when failure rate >= threshold over enough samples", async () => {
    const b = getBreaker(NAME, { minRequests: 10, failureRateThreshold: 0.5 });
    for (let i = 0; i < 6; i++) await b.recordFailure();
    for (let i = 0; i < 4; i++) await b.recordSuccess();
    // Successes after failures may have closed the breaker; fail two more
    // to push the rate back over threshold and trigger the close-time check.
    await b.recordFailure();
    await b.recordFailure();
    await expect(b.allow()).resolves.toBe(false);
    await expect(b.getState()).resolves.toBe("open");
  });

  it("rejects requests during cooldown", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-03T00:00:00Z"));

    const b = getBreaker(NAME, {
      minRequests: 4,
      failureRateThreshold: 0.5,
      cooldownMs: 60_000,
    });
    for (let i = 0; i < 4; i++) await b.recordFailure();
    expect(await b.allow()).toBe(false);

    // Advance 30s — still in cooldown.
    vi.advanceTimersByTime(30_000);
    expect(await b.allow()).toBe(false);
  });

  it("transitions to HALF_OPEN after cooldown elapses, allows one probe", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-03T00:00:00Z"));

    const b = getBreaker(NAME, {
      minRequests: 4,
      failureRateThreshold: 0.5,
      cooldownMs: 60_000,
    });
    for (let i = 0; i < 4; i++) await b.recordFailure();
    expect(await b.allow()).toBe(false);

    vi.advanceTimersByTime(60_001);
    expect(await b.allow()).toBe(true);
    await expect(b.getState()).resolves.toBe("half_open");
  });

  it("CLOSEs after a successful HALF_OPEN probe", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-03T00:00:00Z"));

    const b = getBreaker(NAME, {
      minRequests: 4,
      failureRateThreshold: 0.5,
      cooldownMs: 60_000,
    });
    for (let i = 0; i < 4; i++) await b.recordFailure();
    vi.advanceTimersByTime(60_001);
    await b.allow(); // half-open
    await b.recordSuccess();

    await expect(b.getState()).resolves.toBe("closed");
    await expect(b.allow()).resolves.toBe(true);
  });

  it("re-OPENs and restarts cooldown when HALF_OPEN probe fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-03T00:00:00Z"));

    const b = getBreaker(NAME, {
      minRequests: 4,
      failureRateThreshold: 0.5,
      cooldownMs: 60_000,
    });
    for (let i = 0; i < 4; i++) await b.recordFailure();
    vi.advanceTimersByTime(60_001);
    await b.allow(); // half-open
    await b.recordFailure(); // probe fails

    await expect(b.getState()).resolves.toBe("open");
    expect(await b.allow()).toBe(false);

    // Cooldown should have been reset; advancing only 30s is not enough.
    vi.advanceTimersByTime(30_000);
    expect(await b.allow()).toBe(false);
  });

  it("counts share state across breaker handles with same name", async () => {
    const b1 = getBreaker(NAME, { minRequests: 4, failureRateThreshold: 0.5 });
    const b2 = getBreaker(NAME, { minRequests: 4, failureRateThreshold: 0.5 });
    for (let i = 0; i < 4; i++) await b1.recordFailure();
    expect(await b2.allow()).toBe(false);
  });

  it("isolates state across breaker handles with different names", async () => {
    const a = getBreaker("a", { minRequests: 4, failureRateThreshold: 0.5 });
    const b = getBreaker("b", { minRequests: 4, failureRateThreshold: 0.5 });
    for (let i = 0; i < 4; i++) await a.recordFailure();
    expect(await a.allow()).toBe(false);
    expect(await b.allow()).toBe(true);
  });

  it("fails OPEN on KV outage (allow returns true so POS keeps working)", async () => {
    const b = getBreaker(NAME);
    const original = (kvMod as unknown as { getKv: () => unknown }).getKv;
    Object.defineProperty(kvMod, "getKv", { value: () => null, configurable: true });
    try {
      await expect(b.allow()).resolves.toBe(true);
      await b.recordSuccess();
      await b.recordFailure();
    } finally {
      Object.defineProperty(kvMod, "getKv", { value: original, configurable: true });
    }
  });
});
