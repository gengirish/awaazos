import { describe, expect, it } from "vitest";

import {
  APP_CENTRE_TAB,
  APP_TAB_BAR_SLOTS,
  activeAppNavId,
  appNavItemsForRole,
  appTabBarForRole,
  isAppNavItemActive,
} from "@/lib/app-nav";

describe("appNavItemsForRole", () => {
  it("shows an owner and a manager every destination, in the seller's daily order", () => {
    const all = ["orders", "menu", "store", "drops", "sell", "transactions", "analytics", "settings", "help"];
    expect(appNavItemsForRole("OWNER").map((i) => i.id)).toEqual(all);
    expect(appNavItemsForRole("MANAGER").map((i) => i.id)).toEqual(all);
  });

  it("trims a cashier to Orders, Store, Sell, Settings and Help", () => {
    expect(appNavItemsForRole("CASHIER").map((i) => i.id)).toEqual(["orders", "store", "sell", "settings", "help"]);
  });

  it("names the catalogue for the store", () => {
    expect(appNavItemsForRole("OWNER", "food").find((i) => i.id === "menu")?.label).toBe("Menu");
    expect(appNavItemsForRole("OWNER", "goods").find((i) => i.id === "menu")?.label).toBe("Products");
  });
});

describe("appTabBarForRole", () => {
  const ids = (role: "OWNER" | "MANAGER" | "CASHIER", published: boolean) => {
    const { tabs, more } = appTabBarForRole(role, published);
    return { tabs: tabs.map((i) => i.id), more: more.map((i) => i.id) };
  };

  it("puts Store in the middle and Settings fourth once the store is published", () => {
    for (const role of ["OWNER", "MANAGER"] as const) {
      expect(ids(role, true)).toEqual({
        tabs: ["orders", "menu", "store", "settings"],
        more: ["drops", "sell", "transactions", "analytics", "help"],
      });
    }
  });

  it("keeps Sell fourth while the store is not published: it sells at the counter", () => {
    for (const role of ["OWNER", "MANAGER"] as const) {
      expect(ids(role, false)).toEqual({
        tabs: ["orders", "menu", "store", "sell"],
        more: ["drops", "transactions", "analytics", "settings", "help"],
      });
    }
  });

  it("gives a cashier Orders, Sell and Store, with Settings and Help behind More", () => {
    for (const published of [false, true]) {
      expect(ids("CASHIER", published)).toEqual({ tabs: ["orders", "sell", "store"], more: ["settings", "help"] });
    }
  });

  it("always has the centre tab, and never drops, duplicates or overfills", () => {
    for (const role of ["OWNER", "MANAGER", "CASHIER"] as const) {
      for (const published of [false, true]) {
        const { tabs, more } = appTabBarForRole(role, published);
        expect(tabs.length).toBeLessThanOrEqual(APP_TAB_BAR_SLOTS);
        expect(tabs.map((i) => i.id)).toContain(APP_CENTRE_TAB);
        expect([...tabs, ...more].map((i) => i.id).sort()).toEqual(
          appNavItemsForRole(role)
            .map((i) => i.id)
            .sort(),
        );
      }
    }
  });

  it("labels the bar's catalogue tab for a product store", () => {
    expect(appTabBarForRole("OWNER", true, "goods").tabs.map((i) => i.label)).toEqual([
      "Orders",
      "Products",
      "Store",
      "Settings",
    ]);
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
    ["/store", "store"],
  ] as const)("%s → %s", (pathname, id) => {
    expect(activeAppNavId(pathname)).toBe(id);
  });

  it("matches whole path segments only", () => {
    expect(isAppNavItemActive("/drops", "/dropship")).toBe(false);
    expect(isAppNavItemActive("/pos", "/positions")).toBe(false);
    expect(activeAppNavId("/menus")).toBeNull();
    expect(activeAppNavId("/s/my-store")).toBeNull();
    expect(activeAppNavId("/storefront")).toBeNull();
    expect(activeAppNavId("/")).toBeNull();
  });
});
