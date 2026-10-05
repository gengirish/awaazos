import { describe, expect, it } from "vitest";

import {
  CLOSED_DROP_GRACE_MS,
  formatIstDeadline,
  formatTimeLeft,
  holdMinutesLeft,
  maxOrderableQty,
  orderErrorMessage,
  orderStatusLabel,
  stockLabel,
  storefrontDropVisibility,
  whatsappChatLink,
} from "@/lib/storefront-order";

// Mon 5 Oct 2026, 12:00 IST
const NOW = new Date("2026-10-05T06:30:00.000Z");

describe("storefrontDropVisibility", () => {
  const closesAt = new Date(NOW.getTime() - 60_000);

  it("shows open and scheduled drops", () => {
    expect(storefrontDropVisibility("OPEN", new Date(NOW.getTime() + 1), NOW)).toBe("open");
    expect(storefrontDropVisibility("SCHEDULED", new Date(NOW.getTime() + 1), NOW)).toBe("scheduled");
  });

  it("shows 'closed' only within the grace window after cut-off", () => {
    expect(storefrontDropVisibility("CLOSED", closesAt, NOW)).toBe("closed");
    const old = new Date(NOW.getTime() - CLOSED_DROP_GRACE_MS - 1);
    expect(storefrontDropVisibility("CLOSED", old, NOW)).toBe("hidden");
  });

  it("hides anything else", () => {
    expect(storefrontDropVisibility("DRAFT", closesAt, NOW)).toBe("hidden");
    expect(storefrontDropVisibility("FROZEN", closesAt, NOW)).toBe("hidden");
  });
});

describe("formatIstDeadline", () => {
  it("uses today / tomorrow / weekday / full date in IST", () => {
    expect(formatIstDeadline(new Date("2026-10-05T15:30:00.000Z"), NOW)).toBe("today 9:00 pm");
    expect(formatIstDeadline(new Date("2026-10-06T15:30:00.000Z"), NOW)).toBe("tomorrow 9:00 pm");
    expect(formatIstDeadline(new Date("2026-10-09T15:30:00.000Z"), NOW)).toBe("Fri 9:00 pm");
    expect(formatIstDeadline(new Date("2026-10-16T15:30:00.000Z"), NOW)).toBe("Fri 16 Oct, 9:00 pm");
  });

  it("rolls the IST day over at 18:30 UTC", () => {
    // 00:15 IST on 6 Oct is still 5 Oct in UTC.
    expect(formatIstDeadline(new Date("2026-10-05T18:45:00.000Z"), NOW)).toBe("tomorrow 12:15 am");
  });
});

describe("formatTimeLeft", () => {
  it("formats hours and minutes", () => {
    expect(formatTimeLeft(new Date(NOW.getTime() + 135 * 60_000), NOW)).toBe("2 h 15 min left");
    expect(formatTimeLeft(new Date(NOW.getTime() + 120 * 60_000), NOW)).toBe("2 h left");
    expect(formatTimeLeft(new Date(NOW.getTime() + 45 * 60_000), NOW)).toBe("45 min left");
    expect(formatTimeLeft(new Date(NOW.getTime() + 10_000), NOW)).toBe("1 min left");
  });

  it("returns null when past or far away", () => {
    expect(formatTimeLeft(new Date(NOW.getTime() - 1), NOW)).toBeNull();
    expect(formatTimeLeft(new Date(NOW.getTime() + 49 * 3600_000), NOW)).toBeNull();
  });
});

describe("holdMinutesLeft", () => {
  it("counts down and floors at zero", () => {
    expect(holdMinutesLeft(new Date(NOW.getTime() - 5 * 60_000), 15, NOW)).toBe(10);
    expect(holdMinutesLeft(new Date(NOW.getTime() - 14.5 * 60_000), 15, NOW)).toBe(1);
    expect(holdMinutesLeft(new Date(NOW.getTime() - 16 * 60_000), 15, NOW)).toBe(0);
  });
});

describe("maxOrderableQty / stockLabel", () => {
  it("takes the tightest of remaining, per-order limit and the schema cap", () => {
    expect(maxOrderableQty(null, null)).toBe(99);
    expect(maxOrderableQty(3, null)).toBe(3);
    expect(maxOrderableQty(10, 2)).toBe(2);
    expect(maxOrderableQty(0, 5)).toBe(0);
    expect(maxOrderableQty(500, null)).toBe(99);
  });

  it("labels low stock and sold out", () => {
    expect(stockLabel(null)).toBeNull();
    expect(stockLabel(20)).toBeNull();
    expect(stockLabel(3)).toBe("Only 3 left");
    expect(stockLabel(0)).toBe("Sold out");
  });
});

describe("orderErrorMessage", () => {
  it("maps known codes to buyer copy", () => {
    expect(orderErrorMessage({ error: "sold_out", remaining: 2 }, "Laddu")).toContain("only 2 left");
    expect(orderErrorMessage({ error: "sold_out", remaining: 0 }, "Laddu")).toContain("sold out");
    expect(orderErrorMessage({ error: "per_order_limit", limit: 4 }, "Cake")).toContain("at most 4");
    expect(orderErrorMessage({ error: "monthly_txn_cap_reached" })).toBe(
      "This kitchen can't take online orders right now — message them directly.",
    );
    expect(orderErrorMessage({ error: "drop_not_open" })).toMatch(/closed/);
  });

  it("never leaks plan details and falls back for unknown codes", () => {
    expect(orderErrorMessage({ error: "monthly_txn_cap_reached" })).not.toMatch(/plan|upgrade|limit/i);
    expect(orderErrorMessage({ error: "weird" })).toMatch(/Something went wrong/);
  });
});

describe("orderStatusLabel", () => {
  it("gives text labels for every state", () => {
    expect(orderStatusLabel("AWAITING_PAYMENT", "PLACED").label).toBe("Waiting for payment");
    expect(orderStatusLabel("PAYMENT_SUBMITTED", "PLACED").label).toBe(
      "Payment submitted — the kitchen will confirm",
    );
    expect(orderStatusLabel("PAID", "PLACED").label).toBe("Paid");
    expect(orderStatusLabel("PAY_ON_DELIVERY", "PLACED").label).toBe("Pay on delivery");
    expect(orderStatusLabel("DELIVERED", "DELIVERED").label).toBe("Delivered");
    expect(orderStatusLabel("CANCELLED", "CANCELLED").label).toBe("Cancelled");
    expect(orderStatusLabel("EXPIRED", "PLACED").label).toBe("Expired — items released, please order again");
  });

  it("shows Confirmed once the kitchen accepts, keeping the payment as a hint", () => {
    expect(orderStatusLabel("PAID", "CONFIRMED")).toMatchObject({ label: "Confirmed", hint: "Paid" });
    expect(orderStatusLabel("PAY_ON_DELIVERY", "CONFIRMED")).toMatchObject({
      label: "Confirmed",
      hint: "Pay on delivery",
    });
  });
});

describe("whatsappChatLink", () => {
  it("normalises Indian numbers and encodes the text", () => {
    expect(whatsappChatLink("+91 98765 43210", "Hi, order AWZ-1")).toBe(
      "https://wa.me/919876543210?text=Hi%2C%20order%20AWZ-1",
    );
    expect(whatsappChatLink("9876543210", "x")).toBe("https://wa.me/919876543210?text=x");
  });

  it("rejects unusable numbers", () => {
    expect(whatsappChatLink("12345", "x")).toBeNull();
    expect(whatsappChatLink("", "x")).toBeNull();
  });
});
