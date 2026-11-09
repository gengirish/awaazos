import { describe, expect, it } from "vitest";

import { describeChange } from "@/lib/admin-metric-change";
import { ADMIN_METRICS_CONFIG } from "@/lib/admin-metrics-config";

const SELLERS = { kind: "count", singular: "seller", plural: "sellers" } as const;
const PAISE = { kind: "paise" } as const;
const { activeSellers: SELLER_BASE, gmvPaise: GMV_BASE } = ADMIN_METRICS_CONFIG.smallBase;

describe("describeChange — small-numbers mode", () => {
  it("keeps the thresholds the brief set: 20 sellers, ₹10,000", () => {
    expect(SELLER_BASE).toBe(20);
    expect(GMV_BASE).toBe(1_000_000);
  });

  it("shows an absolute seller change below the baseline, not +150%", () => {
    expect(describeChange(5, 2, SELLER_BASE, SELLERS)).toEqual({
      mode: "absolute",
      label: "+3 sellers",
      tone: "up",
      smallBase: true,
    });
  });

  it("uses the singular for one and a real minus sign for a drop", () => {
    expect(describeChange(4, 5, SELLER_BASE, SELLERS).label).toBe("−1 seller");
    expect(describeChange(4, 5, SELLER_BASE, SELLERS).tone).toBe("down");
  });

  it("says No change, flat, when nothing moved on a small base", () => {
    expect(describeChange(3, 3, SELLER_BASE, SELLERS)).toEqual({
      mode: "absolute",
      label: "No change",
      tone: "flat",
      smallBase: true,
    });
  });

  it("treats a zero baseline as small instead of dividing by it", () => {
    expect(describeChange(4, 0, SELLER_BASE, SELLERS).label).toBe("+4 sellers");
  });

  it("formats an absolute GMV change in rupees with Indian grouping", () => {
    // ₹3,807.15 this week vs ₹110.00 the week before (the brief's example).
    expect(describeChange(380_715, 11_000, GMV_BASE, PAISE).label).toBe("+₹3,697.15");
    expect(describeChange(11_000, 12_345_600, 100_000_000, PAISE).label).toBe("−₹1,23,346.00");
  });

  it("switches to a percentage at the threshold, not above it", () => {
    expect(describeChange(19, 19, SELLER_BASE, SELLERS).mode).toBe("absolute");
    expect(describeChange(25, 20, SELLER_BASE, SELLERS)).toEqual({
      mode: "percent",
      label: "+25.0%",
      tone: "up",
      smallBase: false,
    });
  });

  it("formats a percentage drop and a tiny change", () => {
    expect(describeChange(800_000, 2_000_000, GMV_BASE, PAISE).label).toBe("−60.0%");
    expect(describeChange(2_000_001, 2_000_000, GMV_BASE, PAISE)).toMatchObject({ label: "0.0%", tone: "flat" });
  });
});
