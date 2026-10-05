import { describe, expect, it } from "vitest";

import { buildDropShareText, buildWhatsAppShareUrl, formatShareItemList } from "@/lib/drops-share";
import { istToUtc } from "@/lib/drops-time";

const base = {
  vendorName: "Asha's Kitchen",
  dropTitle: "Saturday Bakes",
  closesAt: istToUtc("2026-10-09", "21:00"),
  fulfilmentStartsAt: istToUtc("2026-10-10", "17:00"),
  fulfilmentEndsAt: istToUtc("2026-10-10", "20:00"),
  fulfilmentMode: "DELIVERY" as const,
  itemNames: ["Ragi laddu", "Thepla", "Banana bread"],
  url: "https://awaazos.vercel.app/s/ashas-kitchen",
};

// ICU may emit a narrow no-break space before am/pm; normalise for comparison.
const norm = (s: string) => s.replace(/[  ]/g, " ");

describe("buildDropShareText", () => {
  it("builds the WhatsApp message with IST times", () => {
    expect(norm(buildDropShareText(base))).toBe(
      [
        "🍪 Saturday Bakes by Asha's Kitchen",
        "Ragi laddu · Thepla · Banana bread",
        "🚚 Delivery Sat, 10 Oct · 5:00 pm – 8:00 pm",
        "⏰ Order by Fri 9:00 pm",
        "Order here: https://awaazos.vercel.app/s/ashas-kitchen",
      ].join("\n"),
    );
  });

  it("labels pickup and both modes", () => {
    expect(buildDropShareText({ ...base, fulfilmentMode: "PICKUP" })).toContain("📍 Pickup Sat, 10 Oct");
    expect(buildDropShareText({ ...base, fulfilmentMode: "BOTH" })).toContain("Delivery or pickup Sat, 10 Oct");
  });

  it("uses the IST weekday for the cut-off even when UTC is a different day", () => {
    // Sat 00:30 IST = Fri 19:00 UTC
    const t = buildDropShareText({ ...base, closesAt: istToUtc("2026-10-10", "00:30") });
    expect(norm(t)).toContain("⏰ Order by Sat 12:30 am");
  });

  it("omits the item line when there are no items", () => {
    const t = buildDropShareText({ ...base, itemNames: [] });
    expect(t.split("\n")).toHaveLength(4);
  });

  it("ends with the URL on its own line", () => {
    expect(buildDropShareText(base).split("\n").at(-1)).toBe(`Order here: ${base.url}`);
  });
});

describe("formatShareItemList", () => {
  it("caps at 6 items and summarises the rest", () => {
    const names = Array.from({ length: 9 }, (_, i) => `Item ${i + 1}`);
    expect(formatShareItemList(names)).toBe(
      "Item 1 · Item 2 · Item 3 · Item 4 · Item 5 · Item 6 and 3 more",
    );
  });
  it("exactly 6 has no suffix", () => {
    const names = Array.from({ length: 6 }, (_, i) => `I${i}`);
    expect(formatShareItemList(names)).not.toContain("more");
  });
  it("drops blank names", () => {
    expect(formatShareItemList([" Thepla ", "", "  "])).toBe("Thepla");
  });
});

describe("buildWhatsAppShareUrl", () => {
  it("URL-encodes the whole message, emoji and newlines included", () => {
    const text = buildDropShareText(base);
    const url = buildWhatsAppShareUrl(text);
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
    expect(url).not.toMatch(/[\n ]/);
    expect(decodeURIComponent(url.slice("https://wa.me/?text=".length))).toBe(text);
  });
  it("encodes & and ? so they don't break the query", () => {
    expect(buildWhatsAppShareUrl("a&b?c=d")).toBe("https://wa.me/?text=a%26b%3Fc%3Dd");
  });
});
