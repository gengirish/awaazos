import type { Redis } from "@upstash/redis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isCronAuthorized } from "@/lib/cron-auth";
import { __setKvForTest } from "@/lib/kv";
import { istDaysUntil, trialEndsPhrase, trialReminderDue } from "@/lib/trial-alerts";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findFirst: vi.fn(),
  reminder: vi.fn(),
  locked: vi.fn(),
  push: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { vendor: { findMany: mocks.findMany, findFirst: mocks.findFirst } },
}));
vi.mock("@/lib/email", () => ({ sendTrialReminderEmail: mocks.reminder, sendStoreLockedEmail: mocks.locked }));
vi.mock("@/lib/push", () => ({
  sendToVendor: mocks.push,
  storeLockedPayload: () => ({ title: "t", body: "b", url: "/settings/billing", tag: "locked-store" }),
}));
vi.mock("@vercel/functions", () => ({ waitUntil: () => undefined }));
vi.mock("@/lib/storefront-razorpay", () => ({ appBaseUrl: () => "https://x.test" }));

const { alertSellerStoreLocked, sendTrialReminders } = await import("@/lib/trial-alerts-server");

/** 09:00 IST on 04/11/2026, when the daily job runs. */
const NOW = new Date("2026-11-04T03:30:00.000Z");
const ist = (s: string) => new Date(`${s}+05:30`);

function fakeKv() {
  const store = new Map<string, unknown>();
  return {
    store,
    async set(k: string, v: unknown, o?: { nx?: boolean }) {
      if (o?.nx && store.has(k)) return null;
      store.set(k, v);
      return "OK";
    },
    async del(k: string) {
      return store.delete(k) ? 1 : 0;
    },
  };
}

function useKv() {
  const kv = fakeKv();
  __setKvForTest(kv as unknown as Redis);
  return kv;
}

function vendor(over: Record<string, unknown> = {}) {
  return {
    id: "v1",
    name: "Sam Store",
    plan: "FREE",
    planExpiresAt: null,
    trialEndsAt: ist("2026-11-09T12:00:00"),
    staff: [{ name: "Sam", userId: "u1", user: { email: "sam@example.com" } }],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.reminder.mockResolvedValue({ delivered: true });
  mocks.locked.mockResolvedValue({ delivered: true });
  mocks.push.mockResolvedValue({ sent: 1, removed: 0, failed: 0 });
});

afterEach(() => {
  __setKvForTest(null);
});

describe("trial reminder rules", () => {
  it("counts IST calendar days, not 24-hour blocks", () => {
    expect(istDaysUntil(ist("2026-11-05T23:59:00"), NOW)).toBe(1);
    expect(istDaysUntil(ist("2026-11-04T23:59:00"), NOW)).toBe(0);
    // 19:00 UTC on the 4th is already the 5th in IST.
    expect(istDaysUntil(new Date("2026-11-04T19:00:00.000Z"), NOW)).toBe(1);
  });

  it.each([
    ["2026-11-10T12:00:00", null],
    ["2026-11-09T23:59:00", "first"],
    ["2026-11-06T12:00:00", "first"],
    ["2026-11-05T23:59:00", "final"],
    ["2026-11-04T23:59:00", "final"],
    ["2026-11-04T08:00:00", null],
  ])("a trial ending %s is due %s", (end, kind) => {
    expect(trialReminderDue(ist(end), NOW)).toBe(kind);
  });

  it("words the end of the trial", () => {
    expect(trialEndsPhrase(0)).toBe("today");
    expect(trialEndsPhrase(1)).toBe("tomorrow");
    expect(trialEndsPhrase(5)).toBe("in 5 days");
  });
});

describe("sendTrialReminders", () => {
  it("sends once, however many times the cron fires that day", async () => {
    useKv();
    mocks.findMany.mockResolvedValue([vendor()]);

    expect(await sendTrialReminders(NOW)).toEqual({ due: 1, sent: 1, skipped: 0, failed: 0 });
    expect(await sendTrialReminders(NOW)).toEqual({ due: 1, sent: 0, skipped: 1, failed: 0 });
    expect(mocks.reminder).toHaveBeenCalledTimes(1);
    expect(mocks.reminder.mock.calls[0]?.[0]).toMatchObject({
      to: "sam@example.com",
      storeName: "Sam Store",
      daysLeft: 5,
    });
  });

  it("only asks for live, real stores", async () => {
    useKv();
    mocks.findMany.mockResolvedValue([]);
    await sendTrialReminders(NOW);
    expect(mocks.findMany.mock.calls[0]?.[0].where).toMatchObject({ isActive: true, isDemo: false });
  });

  it("sends the final reminder after the first, and again for an extended trial", async () => {
    useKv();
    mocks.findMany.mockResolvedValue([vendor()]);
    await sendTrialReminders(NOW);

    mocks.findMany.mockResolvedValue([vendor({ trialEndsAt: ist("2026-11-05T12:00:00") })]);
    await sendTrialReminders(NOW);
    expect(mocks.reminder).toHaveBeenCalledTimes(2);
    expect(mocks.reminder.mock.calls[1]?.[0].daysLeft).toBe(1);

    mocks.findMany.mockResolvedValue([vendor({ trialEndsAt: ist("2026-11-08T12:00:00") })]);
    await sendTrialReminders(NOW);
    expect(mocks.reminder).toHaveBeenCalledTimes(3);
  });

  it("leaves a seller who already subscribed alone", async () => {
    useKv();
    mocks.findMany.mockResolvedValue([vendor({ plan: "STARTER", planExpiresAt: ist("2026-11-09T12:00:00") })]);
    expect(await sendTrialReminders(NOW)).toEqual({ due: 0, sent: 0, skipped: 0, failed: 0 });
    expect(mocks.reminder).not.toHaveBeenCalled();
  });

  it("gives the claim back when the email didn't go, so the next run retries", async () => {
    const kv = useKv();
    mocks.findMany.mockResolvedValue([vendor()]);
    mocks.reminder.mockResolvedValueOnce({ delivered: false });

    expect(await sendTrialReminders(NOW)).toMatchObject({ sent: 0, failed: 1 });
    expect(kv.store.size).toBe(0);
    expect(await sendTrialReminders(NOW)).toMatchObject({ sent: 1, failed: 0 });
  });

  it("sends nothing without KV, because it couldn't stop a repeat", async () => {
    expect(await sendTrialReminders(NOW)).toEqual({ due: 0, sent: 0, skipped: 0, failed: 0 });
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});

describe("alertSellerStoreLocked", () => {
  const row = { name: "Sam Store", staff: vendor().staff };

  it("pushes and emails the owner once, however many buyers try", async () => {
    useKv();
    mocks.findFirst.mockResolvedValue(row);

    await alertSellerStoreLocked("v1");
    await alertSellerStoreLocked("v1");
    await alertSellerStoreLocked("v1");

    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push.mock.calls[0]?.[2]).toEqual({ userId: "u1" });
    expect(mocks.locked).toHaveBeenCalledTimes(1);
    expect(mocks.locked.mock.calls[0]?.[0].billingUrl).toMatch(/\/settings\/billing$/);
  });

  it("keeps each store's daily limit separate", async () => {
    useKv();
    mocks.findFirst.mockResolvedValue(row);
    await alertSellerStoreLocked("v1");
    await alertSellerStoreLocked("v2");
    expect(mocks.locked).toHaveBeenCalledTimes(2);
  });

  it("still emails when the push fails, and counts that as reaching them", async () => {
    const kv = useKv();
    mocks.findFirst.mockResolvedValue(row);
    mocks.push.mockRejectedValueOnce(new Error("push down"));
    await alertSellerStoreLocked("v1");
    expect(mocks.locked).toHaveBeenCalledTimes(1);
    expect(kv.store.size).toBe(1);
  });

  it("gives the claim back when nothing reached them", async () => {
    const kv = useKv();
    mocks.findFirst.mockResolvedValue(row);
    mocks.push.mockResolvedValueOnce({ sent: 0, removed: 0, failed: 0 });
    mocks.locked.mockResolvedValueOnce({ delivered: false });
    await alertSellerStoreLocked("v1");
    expect(kv.store.size).toBe(0);
  });

  it("never throws", async () => {
    useKv();
    mocks.findFirst.mockRejectedValue(new Error("db down"));
    await expect(alertSellerStoreLocked("v1")).resolves.toBeUndefined();
  });
});

describe("isCronAuthorized", () => {
  const req = (auth?: string) =>
    new Request("https://x.test/api/cron/trial-reminders", auth ? { headers: { authorization: auth } } : undefined);

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts only the exact bearer secret", () => {
    vi.stubEnv("CRON_SECRET", "a-long-enough-secret");
    expect(isCronAuthorized(req("Bearer a-long-enough-secret"))).toBe(true);
    expect(isCronAuthorized(req("Bearer wrong"))).toBe(false);
    expect(isCronAuthorized(req("a-long-enough-secret"))).toBe(false);
    expect(isCronAuthorized(req())).toBe(false);
  });

  it("refuses everything when the secret is unset", () => {
    vi.stubEnv("CRON_SECRET", "");
    expect(isCronAuthorized(req())).toBe(false);
    expect(isCronAuthorized(req("Bearer "))).toBe(false);
    expect(isCronAuthorized(req("Bearer undefined"))).toBe(false);
  });
});
