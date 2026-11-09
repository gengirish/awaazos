import { beforeEach, describe, expect, it, vi } from "vitest";

/** A tiny in-memory stand-in for the Upstash pipeline: just the commands store-views uses. */
const store = { hashes: new Map<string, Map<string, number>>(), strings: new Map<string, string>(), ttl: new Map<string, number>() };
let failExec = false;
let kvAvailable = true;

function pipeline() {
  const ops: (() => unknown)[] = [];
  const p = {
    hincrby(key: string, field: string, by: number) {
      ops.push(() => {
        const h = store.hashes.get(key) ?? new Map<string, number>();
        h.set(field, (h.get(field) ?? 0) + by);
        store.hashes.set(key, h);
        return h.get(field);
      });
      return p;
    },
    expire(key: string, seconds: number) {
      ops.push(() => store.ttl.set(key, seconds));
      return p;
    },
    set(key: string, value: string, opts?: { nx?: boolean }) {
      ops.push(() => {
        if (opts?.nx && store.strings.has(key)) return null;
        store.strings.set(key, value);
        return "OK";
      });
      return p;
    },
    get(key: string) {
      ops.push(() => store.strings.get(key) ?? null);
      return p;
    },
    hgetall(key: string) {
      // Upstash deserialises numbers; return them as strings here to prove the read copes.
      ops.push(() => {
        const h = store.hashes.get(key);
        return h ? Object.fromEntries([...h].map(([f, n]) => [f, String(n)])) : null;
      });
      return p;
    },
    async exec() {
      if (failExec) throw new Error("upstash down");
      return ops.map((op) => op());
    },
  };
  return p;
}

const pending: Promise<unknown>[] = [];
vi.mock("@vercel/functions", () => ({ waitUntil: (p: Promise<unknown>) => pending.push(p) }));
vi.mock("@/lib/kv", () => ({ getKv: () => (kvAvailable ? { pipeline } : null) }));

import { countStoreView, readStoreViews, viewsKey } from "@/lib/store-views";

const DAY = 86_400_000;
/** 09/11/2026 00:00 IST. */
const TODAY_IST = new Date("2026-11-08T18:30:00.000Z");

async function flush() {
  await Promise.all(pending.splice(0));
}

beforeEach(() => {
  store.hashes.clear();
  store.strings.clear();
  store.ttl.clear();
  failExec = false;
  kvAvailable = true;
});

describe("viewsKey", () => {
  it("keys by IST calendar day, not UTC", () => {
    expect(viewsKey(new Date(TODAY_IST.getTime() - 1))).toBe("funnel:v1:views:20261108");
    expect(viewsKey(TODAY_IST)).toBe("funnel:v1:views:20261109");
  });
});

describe("countStoreView → readStoreViews", () => {
  it("counts per source across days, keeps 60 days and remembers the first view", async () => {
    const day1 = new Date(TODAY_IST.getTime() - 2 * DAY + 3_600_000);
    const day2 = new Date(TODAY_IST.getTime() - DAY + 3_600_000);
    countStoreView("v1", "instagram", day1);
    countStoreView("v1", "instagram", day2);
    countStoreView("v2", "whatsapp", day2);
    countStoreView("v2", "direct", TODAY_IST); // today: outside the days read below
    await flush();

    const read = await readStoreViews([new Date(TODAY_IST.getTime() - 2 * DAY), new Date(TODAY_IST.getTime() - DAY)]);
    expect(read).toEqual({
      since: day1,
      bySource: { instagram: 2, whatsapp: 1, direct: 0, other: 0 },
    });
    expect(store.ttl.get(viewsKey(day1))).toBe(60 * 24 * 60 * 60);
  });

  it("reports no start date before the first view", async () => {
    expect(await readStoreViews([TODAY_IST])).toEqual({
      since: null,
      bySource: { instagram: 0, whatsapp: 0, direct: 0, other: 0 },
    });
  });

  it("ignores fields that aren't a known source", async () => {
    store.hashes.set(viewsKey(TODAY_IST), new Map([["v1|direct", 3], ["v1|tiktok", 9], ["junk", 4]]));
    const read = await readStoreViews([TODAY_IST]);
    expect(read?.bySource).toEqual({ instagram: 0, whatsapp: 0, direct: 3, other: 0 });
  });

  it("fails open: no KV or a failing KV counts nothing and reads null", async () => {
    failExec = true;
    countStoreView("v1", "direct", TODAY_IST);
    await expect(flush()).resolves.toBeUndefined();
    expect(await readStoreViews([TODAY_IST])).toBeNull();

    kvAvailable = false;
    countStoreView("v1", "direct", TODAY_IST);
    expect(pending).toHaveLength(0);
    expect(await readStoreViews([TODAY_IST])).toBeNull();
  });
});
