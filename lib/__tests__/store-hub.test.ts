import { describe, expect, it } from "vitest";

import { storeLookRows, storeOrderingSummary } from "@/lib/store-hub";

// Thu 12 Nov 2026, 10:00 IST.
const NOW = new Date("2026-11-12T04:30:00Z");
const hours = (h: number) => new Date(NOW.getTime() + h * 3_600_000);
const vocab = { catalogue: "menu" };

describe("storeOrderingSummary", () => {
  it("is idle with order-any-time off and no drop taking orders", () => {
    expect(storeOrderingSummary({ acceptMenuOrders: false, drops: [] }, vocab, NOW)).toEqual({ lines: [], idle: true });
  });

  it("names the everyday catalogue when order-any-time is on", () => {
    const s = storeOrderingSummary({ acceptMenuOrders: true, drops: [] }, { catalogue: "products" }, NOW);
    expect(s.idle).toBe(false);
    expect(s.lines).toEqual([{ tone: "on", text: "Buyers can order from your products any time." }]);
  });

  it("lists open drops by cut-off and later ones by their start", () => {
    const s = storeOrderingSummary(
      {
        acceptMenuOrders: false,
        drops: [
          { title: "Weekend bakes", status: "OPEN", opensAt: null, closesAt: hours(30) },
          { title: "Diwali boxes", status: "OPEN", opensAt: hours(4), closesAt: hours(50) },
          { title: "Lunch", status: "OPEN", opensAt: null, closesAt: hours(2) },
        ],
      },
      vocab,
      NOW,
    );
    expect(s.lines).toEqual([
      { tone: "on", text: "Lunch: taking orders until today 12:00 pm." },
      { tone: "on", text: "Weekend bakes: taking orders until tomorrow 4:00 pm." },
      { tone: "soon", text: "Diwali boxes: opens today 2:00 pm." },
    ]);
  });

  it("leaves out a drop whose cut-off has passed: nothing flips it, the time does", () => {
    const s = storeOrderingSummary(
      { acceptMenuOrders: false, drops: [{ title: "Old", status: "OPEN", opensAt: null, closesAt: hours(-1) }] },
      vocab,
      NOW,
    );
    expect(s).toEqual({ lines: [], idle: true });
  });
});

describe("storeLookRows", () => {
  const empty = { bannerUrl: null, logoUrl: null, theme: null, tagline: null, instagramHandle: null };

  it("nudges for what is missing and never for the colour", () => {
    expect(storeLookRows(empty).map((r) => [r.id, r.value, r.done])).toEqual([
      ["banner-logo", "Add a photo", false],
      ["store-colour", "Saffron", true],
      ["tagline", "Add one line about your store", false],
      ["instagram", "Add your handle", false],
    ]);
  });

  it("shows what is set", () => {
    const rows = storeLookRows({
      bannerUrl: "https://blob/b.jpg",
      logoUrl: null,
      theme: "green",
      tagline: "Fresh bakes every weekend",
      instagramHandle: "sambakes",
    });
    expect(rows.map((r) => [r.value, r.done])).toEqual([
      ["Only the banner", false],
      ["Green", true],
      ["Fresh bakes every weekend", true],
      ["@sambakes", true],
    ]);
    expect(storeLookRows({ ...empty, bannerUrl: "b", logoUrl: "l" })[0]).toMatchObject({ value: "Both added", done: true });
  });
});
