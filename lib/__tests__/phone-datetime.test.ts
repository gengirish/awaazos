import { describe, expect, it } from "vitest";

import { formatIstDate, formatIstDateTime } from "@/lib/datetime";
import { formatIndianMobile, lastFourDigits, normaliseIndianMobile } from "@/lib/phone";

describe("phone", () => {
  it("normalises 10-digit and 91-prefixed mobiles to E.164", () => {
    expect(normaliseIndianMobile("98765 43210")).toBe("+919876543210");
    expect(normaliseIndianMobile("+91 98765-43210")).toBe("+919876543210");
    expect(normaliseIndianMobile("919876543210")).toBe("+919876543210");
  });

  it("keeps empty as empty and passes anything else through trimmed", () => {
    expect(normaliseIndianMobile("  ")).toBe("");
    expect(normaliseIndianMobile(" 12345 ")).toBe("12345");
  });

  it("formats +91 E.164 for display and leaves other values alone", () => {
    expect(formatIndianMobile("+919876543210")).toBe("98765 43210");
    expect(formatIndianMobile("+14155550100")).toBe("+14155550100");
    expect(formatIndianMobile(null)).toBe("");
  });

  it("keeps only the last four digits", () => {
    expect(lastFourDigits("+91 98765-43210")).toBe("3210");
  });
});

describe("datetime", () => {
  // 2026-10-05T12:00:00Z is 17:30 IST.
  const d = new Date("2026-10-05T12:00:00Z");

  it("formats DD/MM/YYYY in IST", () => {
    expect(formatIstDate(d)).toBe("05/10/2026");
    // 20:00Z is already the next calendar day in IST.
    expect(formatIstDate(new Date("2026-10-05T20:00:00Z"))).toBe("06/10/2026");
  });

  it("formats DD/MM/YYYY, HH:mm in IST from a Date or ISO string", () => {
    expect(formatIstDateTime(d)).toBe("05/10/2026, 17:30");
    expect(formatIstDateTime(d.toISOString())).toBe("05/10/2026, 17:30");
  });
});
