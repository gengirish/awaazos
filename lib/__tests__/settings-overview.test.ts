import { describe, expect, it } from "vitest";

import {
  LEGACY_SETTINGS_ANCHORS,
  notificationsStatus,
  ordersStatus,
  paymentsStatus,
  planStatus,
  setupChecklist,
  storeStatus,
  voiceLanguageLabel,
  voiceStatus,
} from "../settings-overview";

describe("settings hub status lines", () => {
  it("store: live with the link, or not published", () => {
    expect(storeStatus({ slug: "ravi-chai", publishStorefront: true })).toEqual({
      text: "Live · /s/ravi-chai",
      on: true,
    });
    expect(storeStatus({ slug: "ravi-chai", publishStorefront: false })).toEqual({
      text: "Not published",
      on: false,
    });
  });

  it("orders: names the fulfilment mode only when on", () => {
    expect(ordersStatus({ acceptMenuOrders: true, menuFulfilmentMode: "BOTH" }).text).toBe(
      "Order from menu: On · Pickup or delivery",
    );
    expect(ordersStatus({ acceptMenuOrders: true, menuFulfilmentMode: "PICKUP" }).text).toBe(
      "Order from menu: On · Pickup only",
    );
    expect(ordersStatus({ acceptMenuOrders: false, menuFulfilmentMode: "DELIVERY" })).toEqual({
      text: "Order from menu: Off",
      on: false,
    });
  });

  it("payments: one part per method; on when customers have some way to pay", () => {
    const s = paymentsStatus({ upiId: "shop@okaxis", acceptPayOnDelivery: true, razorpayConfigured: false });
    expect(s.parts).toEqual([
      { label: "UPI", on: true },
      { label: "Pay on delivery", on: true },
      { label: "Razorpay", on: false },
    ]);
    expect(s.text).toBe("UPI on · Pay on delivery on · Razorpay off");
    expect(s.on).toBe(true);

    expect(paymentsStatus({ upiId: "  ", acceptPayOnDelivery: false, razorpayConfigured: true }).on).toBe(false);
  });

  it("voice: picker labels, legacy codes, and a safe default", () => {
    expect(voiceLanguageLabel("en-IN")).toBe("English");
    expect(voiceLanguageLabel("hi-IN")).toBe("हिन्दी (Hindi)");
    expect(voiceLanguageLabel("te-IN")).toBe("Telugu");
    expect(voiceLanguageLabel("xx")).toBe("English");
    expect(voiceStatus({ voiceLang: "hi-IN" }).text).toBe("हिन्दी (Hindi)");
  });

  it("notifications: not set up without VAPID, off with no devices, device count when on", () => {
    expect(notificationsStatus({ pushConfigured: false, pushDeviceCount: 3 })).toEqual({ text: "Not set up", on: false });
    expect(notificationsStatus({ pushConfigured: true, pushDeviceCount: 0 })).toEqual({ text: "Off", on: false });
    expect(notificationsStatus({ pushConfigured: true, pushDeviceCount: 1 })).toEqual({ text: "On · 1 device", on: true });
    expect(notificationsStatus({ pushConfigured: true, pushDeviceCount: 4 }).text).toBe("On · 4 devices");
  });

  it("plan: uses the plan label", () => {
    expect(planStatus({ plan: "FREE" }).text).toBe("Free plan");
  });
});

describe("setupChecklist", () => {
  const ready = { availableItemCount: 3, publishStorefront: true, upiId: null, acceptPayOnDelivery: true };

  it("is empty when the stall can take online orders", () => {
    expect(setupChecklist(ready)).toEqual([]);
    expect(setupChecklist({ ...ready, upiId: "a.b@ybl", acceptPayOnDelivery: false })).toEqual([]);
  });

  it("lists every missing step with where to fix it", () => {
    const items = setupChecklist({ availableItemCount: 0, publishStorefront: false, upiId: "", acceptPayOnDelivery: false });
    expect(items.map((i) => [i.id, i.href])).toEqual([
      ["menu_items", "/menu"],
      ["publish_store", "/settings/store"],
      ["payment_method", "/settings/payments"],
    ]);
  });

  it("needs a payment method only when both UPI and pay on delivery are missing", () => {
    expect(setupChecklist({ ...ready, acceptPayOnDelivery: false }).map((i) => i.id)).toEqual(["payment_method"]);
  });
});

describe("legacy anchors", () => {
  it("maps every old /settings# anchor to a section page", () => {
    expect(LEGACY_SETTINGS_ANCHORS).toEqual({
      storefront: "/settings/store",
      "pre-orders": "/settings/payments",
      "menu-orders": "/settings/orders",
      "online-payments": "/settings/payments",
    });
  });
});
