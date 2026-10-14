import { describe, expect, it } from "vitest";

import {
  APP_TAB_BAR_SLOTS,
  activeAppNavId,
  appNavItemsForRole,
  appTabBarForRole,
  isAppNavItemActive,
} from "@/lib/app-nav";

describe("appNavItemsForRole", () => {
  it("shows an owner and a manager every destination", () => {
    const all = ["orders", "drops", "sell", "menu", "transactions", "analytics", "settings", "help"];
    expect(appNavItemsForRole("OWNER").map((i) => i.id)).toEqual(all);
    expect(appNavItemsForRole("MANAGER").map((i) => i.id)).toEqual(all);
  });

  it("trims a cashier to Orders, Sell, Settings and Help", () => {
    expect(appNavItemsForRole("CASHIER").map((i) => i.id)).toEqual(["orders", "sell", "settings", "help"]);
  });

  it("keeps Orders, Drops, Sell and Menu on the tab bar and the rest behind More", () => {
    const items = appNavItemsForRole("OWNER");
    expect(items.filter((i) => i.placement === "tab").map((i) => i.label)).toEqual(["Orders", "Drops", "Sell", "Menu"]);
    expect(items.filter((i) => i.placement === "more").map((i) => i.label)).toEqual([
      "Transactions",
      "Analytics",
      "Settings",
      "Help",
    ]);
  });
});

describe("appTabBarForRole", () => {
  const ids = (role: "OWNER" | "MANAGER" | "CASHIER", published: boolean) => {
    const { tabs, more } = appTabBarForRole(role, published);
    return { tabs: tabs.map((i) => i.id), more: more.map((i) => i.id) };
  };

  it("keeps the usual bar while the store is not published", () => {
    for (const role of ["OWNER", "MANAGER"] as const) {
      expect(ids(role, false)).toEqual({
        tabs: ["orders", "drops", "sell", "menu"],
        more: ["transactions", "analytics", "settings", "help"],
      });
    }
    expect(ids("CASHIER", false)).toEqual({ tabs: ["orders", "sell"], more: ["settings", "help"] });
  });

  it("swaps Sell for Settings once the store is published", () => {
    for (const role of ["OWNER", "MANAGER"] as const) {
      expect(ids(role, true)).toEqual({
        tabs: ["orders", "drops", "menu", "settings"],
        more: ["sell", "transactions", "analytics", "help"],
      });
    }
  });

  it("leaves a cashier's Sell on the bar when published: their destinations all fit", () => {
    expect(ids("CASHIER", true)).toEqual({ tabs: ["orders", "sell", "settings"], more: ["help"] });
  });

  it("never drops or duplicates a destination, and never overfills the bar", () => {
    for (const role of ["OWNER", "MANAGER", "CASHIER"] as const) {
      for (const published of [false, true]) {
        const { tabs, more } = appTabBarForRole(role, published);
        expect(tabs.length).toBeLessThanOrEqual(APP_TAB_BAR_SLOTS);
        expect([...tabs, ...more].map((i) => i.id).sort()).toEqual(
          appNavItemsForRole(role)
            .map((i) => i.id)
            .sort(),
        );
        expect(tabs.every((i) => i.placement === "tab")).toBe(true);
        expect(more.every((i) => i.placement === "more")).toBe(true);
      }
    }
  });
});

describe("active destination", () => {
  it.each([
    ["/pos", "sell"],
    ["/orders", "orders"],
    ["/drops", "drops"],
    ["/drops/new", "drops"],
    ["/drops/abc123", "drops"],
    ["/drops/abc123/prep", "drops"],
    ["/menu", "menu"],
    ["/transactions", "transactions"],
    ["/analytics", "analytics"],
    ["/settings", "settings"],
    ["/settings/payments", "settings"],
    ["/help", "help"],
  ] as const)("%s → %s", (pathname, id) => {
    expect(activeAppNavId(pathname)).toBe(id);
  });

  it("matches whole path segments only", () => {
    expect(isAppNavItemActive("/drops", "/dropship")).toBe(false);
    expect(isAppNavItemActive("/pos", "/positions")).toBe(false);
    expect(activeAppNavId("/menus")).toBeNull();
    expect(activeAppNavId("/")).toBeNull();
  });
});
