import { describe, expect, it } from "vitest";

import {
  parseRecentOrders,
  RECENT_ORDER_LIMIT,
  RECENT_ORDER_TTL_MS,
  recentOrdersStorageKey,
  serializeRecentOrders,
  withRecentOrder,
  type RecentOrder,
} from "@/components/storefront/recent-orders";

const NOW = Date.UTC(2026, 9, 14, 12, 0, 0);
const order = (n: number, ageMs = 0): RecentOrder => ({
  token: `tok-${n}`,
  billNumber: `AWZ-20261014-000${n}`,
  createdAt: NOW - ageMs,
});

describe("recent orders (device-local)", () => {
  it("keys the list per store", () => {
    expect(recentOrdersStorageKey("meera-bakes")).toBe("awz-orders:meera-bakes");
  });

  it("round-trips entries newest first and stores nothing but token, bill number and time", () => {
    const raw = serializeRecentOrders([order(1, 5_000), order(2, 1_000)]);
    expect(parseRecentOrders(raw, NOW).map((o) => o.token)).toEqual(["tok-2", "tok-1"]);
    expect(Object.keys(JSON.parse(raw).orders[0]).sort()).toEqual(["billNumber", "createdAt", "token"]);
  });

  it("drops stale, malformed and duplicate entries", () => {
    const raw = JSON.stringify({
      v: 1,
      orders: [
        order(1, RECENT_ORDER_TTL_MS + 1),
        order(2),
        order(2),
        { token: "", billNumber: "AWZ-1", createdAt: NOW },
        { token: "x", billNumber: "AWZ-2", createdAt: "yesterday" },
        null,
      ],
    });
    expect(parseRecentOrders(raw, NOW)).toEqual([order(2)]);
    expect(parseRecentOrders("not json", NOW)).toEqual([]);
    expect(parseRecentOrders(JSON.stringify({ v: 2, orders: [order(1)] }), NOW)).toEqual([]);
    expect(parseRecentOrders(null, NOW)).toEqual([]);
  });

  it("caps the list and replaces an entry with the same token", () => {
    let list: RecentOrder[] = [];
    for (let n = 1; n <= RECENT_ORDER_LIMIT + 2; n++) list = withRecentOrder(list, order(n, 10_000 - n));
    expect(list).toHaveLength(RECENT_ORDER_LIMIT);
    expect(list[0].token).toBe(`tok-${RECENT_ORDER_LIMIT + 2}`);
    expect(withRecentOrder(list, list[1])).toEqual(list);
  });
});
