import { describe, expect, it } from "vitest";

import { activeAppNavId, appNavItemsForRole, isAppNavItemActive } from "@/lib/app-nav";

describe("appNavItemsForRole", () => {
  it("shows an owner and a manager every destination", () => {
    const all = ["orders", "drops", "sell", "menu", "transactions", "analytics", "settings"];
    expect(appNavItemsForRole("OWNER").map((i) => i.id)).toEqual(all);
    expect(appNavItemsForRole("MANAGER").map((i) => i.id)).toEqual(all);
  });

  it("trims a cashier to Orders, Sell and Settings", () => {
    expect(appNavItemsForRole("CASHIER").map((i) => i.id)).toEqual(["orders", "sell", "settings"]);
  });

  it("keeps Orders, Drops, Sell and Menu on the tab bar and the rest behind More", () => {
    const items = appNavItemsForRole("OWNER");
    expect(items.filter((i) => i.placement === "tab").map((i) => i.label)).toEqual(["Orders", "Drops", "Sell", "Menu"]);
    expect(items.filter((i) => i.placement === "more").map((i) => i.label)).toEqual([
      "Transactions",
      "Analytics",
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
