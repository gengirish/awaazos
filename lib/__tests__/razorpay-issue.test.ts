import type { Redis } from "@upstash/redis";
import { afterEach, describe, expect, it } from "vitest";

import { __setKvForTest } from "@/lib/kv";
import {
  classifyRazorpayRefusal,
  clearRazorpayIssue,
  getRazorpayIssue,
  recordRazorpayIssue,
} from "@/lib/razorpay-issue";

function fakeKv(opts: { failing?: boolean } = {}) {
  const store = new Map<string, { value: unknown; ex?: number }>();
  const guard = () => {
    if (opts.failing) throw new Error("kv down");
  };
  const kv = {
    store,
    async set(k: string, value: unknown, o?: { ex?: number }) {
      guard();
      store.set(k, { value, ex: o?.ex });
      return "OK";
    },
    async get(k: string) {
      guard();
      return store.get(k)?.value ?? null;
    },
    async del(k: string) {
      guard();
      return store.delete(k) ? 1 : 0;
    },
  };
  return kv;
}

afterEach(() => {
  __setKvForTest(null);
});

describe("classifyRazorpayRefusal", () => {
  it("401 is the connection, 400/403 the account, anything else isn't the seller's to fix", () => {
    expect(classifyRazorpayRefusal(401)).toBe("auth");
    expect(classifyRazorpayRefusal(400)).toBe("account");
    expect(classifyRazorpayRefusal(403)).toBe("account");
    expect(classifyRazorpayRefusal(500)).toBeNull();
    expect(classifyRazorpayRefusal(502)).toBeNull();
    expect(classifyRazorpayRefusal(429)).toBeNull();
  });
});

describe("issue store", () => {
  it("records with a 30-day TTL, reads back, clears", async () => {
    const kv = fakeKv();
    __setKvForTest(kv as unknown as Redis);
    const at = new Date("2026-10-30T10:00:00.000Z");
    await recordRazorpayIssue("v1", "account", at);
    expect(kv.store.get("rzp-issue:v1")?.ex).toBe(30 * 24 * 60 * 60);
    expect(await getRazorpayIssue("v1")).toEqual({ kind: "account", at: at.toISOString() });
    expect(await getRazorpayIssue("v2")).toBeNull();
    await clearRazorpayIssue("v1");
    expect(await getRazorpayIssue("v1")).toBeNull();
  });

  it("ignores junk values", async () => {
    const kv = fakeKv();
    __setKvForTest(kv as unknown as Redis);
    kv.store.set("rzp-issue:v1", { value: { kind: "other", at: 1 } });
    expect(await getRazorpayIssue("v1")).toBeNull();
  });

  it("fails open when KV is down or not configured", async () => {
    __setKvForTest(fakeKv({ failing: true }) as unknown as Redis);
    await expect(recordRazorpayIssue("v1", "auth")).resolves.toBeUndefined();
    await expect(clearRazorpayIssue("v1")).resolves.toBeUndefined();
    await expect(getRazorpayIssue("v1")).resolves.toBeNull();
  });
});
