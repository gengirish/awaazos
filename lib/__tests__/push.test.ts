/**
 * lib/push.ts — pure parts (no DB). DB-backed behaviour of sendToVendor lives
 * in push.db.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  sendNotification: vi.fn(),
  setVapidDetails: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { pushSubscription: { findMany: mocks.findMany, updateMany: vi.fn(), deleteMany: vi.fn() } },
}));
vi.mock("web-push", () => ({
  default: { sendNotification: mocks.sendNotification, setVapidDetails: mocks.setVapidDetails },
}));

import {
  __resetPushConfigForTest,
  isPushConfigured,
  newOrderPayload,
  notifyVendorInBackground,
  paymentSubmittedPayload,
  sendToVendor,
} from "../push";

const VAPID_KEYS = ["NEXT_PUBLIC_VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"] as const;

describe("push payload builders", () => {
  it("new order: bill number, amount and item count; menu orders open /orders", () => {
    const p = newOrderPayload({ billNumber: "AWZ-20261006-0007", totalPaise: 15050, itemCount: 3, dropId: null });
    expect(p.title).toBe("🛒 New order");
    expect(p.body).toContain("AWZ-20261006-0007");
    expect(p.body).toContain("₹150.50");
    expect(p.body).toContain("3 items");
    expect(p.url).toBe("/orders");
    expect(p.tag).toBe("order-AWZ-20261006-0007");
  });

  it("new order: singular item, drop orders open the drop board", () => {
    const p = newOrderPayload({ billNumber: "AWZ-1", totalPaise: 2000, itemCount: 1, dropId: "drop_123" });
    expect(p.body).toContain("1 item");
    expect(p.body).not.toContain("1 items");
    expect(p.url).toBe("/drops/drop_123");
  });

  it("payment submitted: right URL and tag per event", () => {
    expect(paymentSubmittedPayload({ billNumber: "AWZ-9", totalPaise: 5000, dropId: null })).toMatchObject({
      title: "💸 Payment to check",
      url: "/orders",
      tag: "pay-AWZ-9",
    });
    expect(paymentSubmittedPayload({ billNumber: "AWZ-9", totalPaise: 5000, dropId: "d1" }).url).toBe("/drops/d1");
  });

  it("builders accept no buyer fields, and extra fields never leak into the payload", () => {
    const input = {
      billNumber: "AWZ-2",
      totalPaise: 1000,
      itemCount: 2,
      dropId: null,
      customerName: "Meera Iyer",
      customerPhone: "+919876543210",
      utr: "412345678901",
    };
    for (const p of [newOrderPayload(input), paymentSubmittedPayload(input)]) {
      const json = JSON.stringify(p);
      expect(Object.keys(p).sort()).toEqual(["body", "tag", "title", "url"]);
      expect(json).not.toMatch(/Meera|9876543210|412345678901/);
    }
  });
});

describe("push when VAPID env is missing", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of VAPID_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    __resetPushConfigForTest();
    vi.clearAllMocks();
  });
  afterEach(() => {
    for (const k of VAPID_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    __resetPushConfigForTest();
  });

  it("is a silent no-op: no DB read, no send", async () => {
    expect(isPushConfigured()).toBe(false);
    await expect(sendToVendor("v1", newOrderPayload({ billNumber: "A", totalPaise: 1, itemCount: 1, dropId: null }))).resolves.toEqual({
      sent: 0,
      removed: 0,
      failed: 0,
    });
    notifyVendorInBackground("v1", newOrderPayload({ billNumber: "A", totalPaise: 1, itemCount: 1, dropId: null }));
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.sendNotification).not.toHaveBeenCalled();
    expect(mocks.setVapidDetails).not.toHaveBeenCalled();
  });
});
