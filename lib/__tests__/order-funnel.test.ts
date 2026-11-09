import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { fillAdminTemplate } from "@/lib/admin-template";
import {
  FUNNEL_SOURCES,
  type FunnelOrderInput,
  buildOrderFunnel,
  funnelSourceOf,
  isCountableStoreView,
  parseStalledFilter,
  paymentStageOf,
  stepRate,
} from "@/lib/order-funnel";

/** 09/11/2026 00:00 IST; the window is 02/11 to 08/11. */
const TODAY = new Date("2026-11-08T18:30:00.000Z");
const DAY = 86_400_000;
const WINDOW_START = new Date(TODAY.getTime() - 7 * DAY);
const at = (daysAgo: number) => new Date(TODAY.getTime() - daysAgo * DAY + 12 * 3_600_000);

let seq = 0;
function order(over: Partial<FunnelOrderInput> = {}): FunnelOrderInput {
  seq += 1;
  return {
    id: `o${seq}`,
    vendorId: "v1",
    billNumber: `AWZ-20261105-${String(seq).padStart(4, "0")}`,
    totalPaise: 50_000,
    createdAt: at(3),
    orderChannel: null,
    paymentMethod: "UPI",
    paymentStatus: "PENDING",
    razorpayStarted: false,
    paymentClaimedAt: null,
    paymentRejectedAt: null,
    fulfilmentStatus: "PLACED",
    ...over,
  };
}

const noViews = { since: null, bySource: { instagram: 0, whatsapp: 0, direct: 0, other: 0 } };

function headers(map: Record<string, string>) {
  const lower = Object.fromEntries(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name: string) => lower[name.toLowerCase()] ?? null };
}

const PHONE_CHROME = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36";

describe("funnelSourceOf", () => {
  it("maps stored channels to columns, null to Direct and anything else to Other", () => {
    expect(funnelSourceOf("instagram")).toBe("instagram");
    expect(funnelSourceOf("whatsapp")).toBe("whatsapp");
    expect(funnelSourceOf(null)).toBe("direct");
    expect(funnelSourceOf("facebook")).toBe("other");
  });
});

describe("isCountableStoreView", () => {
  it("counts a phone browser's full page load", () => {
    expect(isCountableStoreView(headers({ "user-agent": PHONE_CHROME, "Sec-Fetch-Mode": "navigate" }))).toBe(true);
    // A browser too old to send Sec-Fetch-Mode.
    expect(isCountableStoreView(headers({ "user-agent": PHONE_CHROME }))).toBe(true);
  });

  it("skips link previews, bots, headless browsers and empty agents", () => {
    for (const ua of [
      "WhatsApp/2.23.20.0 A",
      "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/120.0 Safari/537.36",
      "curl/8.4.0",
      "",
    ]) {
      expect(isCountableStoreView(headers({ "user-agent": ua })), ua).toBe(false);
    }
  });

  it("skips client-side refreshes and prefetches", () => {
    // router.refresh() / client navigation: Next strips RSC, the browser still says it's a fetch.
    expect(isCountableStoreView(headers({ "user-agent": PHONE_CHROME, "Sec-Fetch-Mode": "cors" }))).toBe(false);
    expect(isCountableStoreView(headers({ "user-agent": PHONE_CHROME, RSC: "1" }))).toBe(false);
    expect(isCountableStoreView(headers({ "user-agent": PHONE_CHROME, "Next-Router-Prefetch": "1" }))).toBe(false);
    expect(isCountableStoreView(headers({ "user-agent": PHONE_CHROME, "Sec-Purpose": "prefetch;prerender" }))).toBe(false);
    expect(isCountableStoreView(headers({ "user-agent": PHONE_CHROME, Purpose: "prefetch" }))).toBe(false);
  });
});

describe("paymentStageOf", () => {
  it("reads each payment signal", () => {
    expect(paymentStageOf(order())).toBe("not_started");
    expect(paymentStageOf(order({ razorpayStarted: true }))).toBe("started");
    expect(paymentStageOf(order({ paymentClaimedAt: at(3) }))).toBe("started");
    expect(paymentStageOf(order({ paymentRejectedAt: at(3) }))).toBe("started");
    expect(paymentStageOf(order({ paymentMethod: "CASH" }))).toBe("started");
    expect(paymentStageOf(order({ paymentStatus: "PAID" }))).toBe("paid");
    expect(paymentStageOf(order({ paymentStatus: "REFUNDED" }))).toBe("paid");
  });
});

describe("buildOrderFunnel", () => {
  it("is empty and quiet with no orders", () => {
    const f = buildOrderFunnel({ orders: [], views: noViews, windowStart: WINDOW_START });
    expect(f.placed.total).toBe(0);
    expect(f.biggestLeak).toBeNull();
    expect(f.stalled).toEqual([]);
    expect(f.views).toEqual({ status: "not_started" });
  });

  it("reconciles: every order is placed once, columns add up, each stage is inside the one before", () => {
    const channels = ["instagram", "whatsapp", null, "facebook"] as const;
    const orders = Array.from({ length: 50 }, (_, i) =>
      order({
        orderChannel: channels[i % 4],
        createdAt: at(1 + (i % 7)),
        paymentStatus: i % 3 === 0 ? "PAID" : "PENDING",
        razorpayStarted: i % 3 === 1,
      }),
    );
    const f = buildOrderFunnel({ orders, views: noViews, windowStart: WINDOW_START });

    expect(f.placed.total).toBe(50);
    for (const stage of [f.placed, f.started, f.paid]) {
      expect(FUNNEL_SOURCES.reduce((sum, s) => sum + stage.bySource[s], 0)).toBe(stage.total);
    }
    expect(f.placed.bySource).toEqual({ instagram: 13, whatsapp: 13, direct: 12, other: 12 });
    expect(f.paid.total).toBe(17);
    expect(f.started.total).toBe(17 + 17);
    for (const s of FUNNEL_SOURCES) {
      expect(f.started.bySource[s]).toBeLessThanOrEqual(f.placed.bySource[s]);
      expect(f.paid.bySource[s]).toBeLessThanOrEqual(f.started.bySource[s]);
    }
    expect(f.stalled).toHaveLength(50 - 17);
    expect(f.paid.total + f.stalled.length).toBe(f.placed.total);
  });

  it("names the step that loses the most orders", () => {
    const orders = [
      order({ paymentStatus: "PAID" }),
      order({ razorpayStarted: true }),
      order(),
      order(),
      order(),
    ];
    const f = buildOrderFunnel({ orders, views: noViews, windowStart: WINDOW_START });
    expect(f.biggestLeak).toEqual({ from: "Order placed", to: "Payment started", lost: 3, of: 5 });
  });

  it("uses views only when they cover the whole window", () => {
    const orders = [order({ paymentStatus: "PAID" })];
    const views = { since: new Date(WINDOW_START.getTime() - DAY), bySource: { instagram: 30, whatsapp: 5, direct: 5, other: 0 } };
    const full = buildOrderFunnel({ orders, views, windowStart: WINDOW_START });
    expect(full.views).toMatchObject({ status: "full", counts: { total: 40 } });
    expect(full.biggestLeak).toEqual({ from: "Store view", to: "Order placed", lost: 39, of: 40 });

    const partial = buildOrderFunnel({ orders, views: { ...views, since: at(2) }, windowStart: WINDOW_START });
    expect(partial.views).toMatchObject({ status: "partial", since: at(2) });
    expect(partial.biggestLeak).toBeNull();

    expect(buildOrderFunnel({ orders, views: null, windowStart: WINDOW_START }).views).toEqual({ status: "unavailable" });
  });

  it("lists unpaid orders newest first with what they reached and their status", () => {
    const older = order({ createdAt: at(6), paymentMethod: "CASH", fulfilmentStatus: "CONFIRMED" });
    const newer = order({ createdAt: at(1), orderChannel: "instagram", fulfilmentStatus: "CANCELLED" });
    const handed = order({ createdAt: at(4), paymentClaimedAt: at(4), fulfilmentStatus: "DELIVERED" });
    const f = buildOrderFunnel({ orders: [older, newer, handed, order({ paymentStatus: "PAID" })], views: noViews, windowStart: WINDOW_START });

    expect(f.stalled.map((o) => o.id)).toEqual([newer.id, handed.id, older.id]);
    expect(f.stalled[0]).toMatchObject({ source: "instagram", stage: "not_started", status: "cancelled", payOnDelivery: false });
    expect(f.stalled[1]).toMatchObject({ stage: "started", status: "delivered" });
    expect(f.stalled[2]).toMatchObject({ stage: "started", status: "open", payOnDelivery: true });
  });
});

describe("stepRate", () => {
  it("rounds to a whole percent and refuses to divide by zero", () => {
    expect(stepRate(1, 3)).toBe("33%");
    expect(stepRate(0, 4)).toBe("0%");
    expect(stepRate(0, 0)).toBeNull();
  });
});

describe("parseStalledFilter", () => {
  it("accepts a known filter and ignores anything else", () => {
    expect(parseStalledFilter("started")).toBe("started");
    expect(parseStalledFilter(["not_started", "x"])).toBe("not_started");
    expect(parseStalledFilter("paid")).toBeNull();
    expect(parseStalledFilter(undefined)).toBeNull();
  });
});

describe("Remind copy", () => {
  const values = {
    storeName: "Asha's Bakes",
    billNumber: "AWZ-20261108-0004",
    amount: "₹1,250.00",
    placedAt: "08/11/2026, 17:30 IST",
    boardUrl: "https://x.test/orders",
  };

  it("fills every variable in the shipped template", () => {
    const text = readFileSync(path.join(process.cwd(), "content", "admin-nudges", "stalled-order.txt"), "utf8");
    const filled = fillAdminTemplate(text, { firstName: "Asha Rao", senderName: "Girish Hiremath", values });
    expect(filled).not.toMatch(/\{\w+\}/);
    expect(filled).toContain("Hi Asha, this is Girish");
    expect(filled).toContain("AWZ-20261108-0004");
    expect(filled).toContain("https://x.test/orders");
  });

  it("drops a missing first name with its space and keeps unknown tokens", () => {
    expect(fillAdminTemplate("Hi {firstName}, {billNumber} {typo}", { firstName: null, senderName: null, values })).toBe(
      "Hi, AWZ-20261108-0004 {typo}",
    );
  });
});
