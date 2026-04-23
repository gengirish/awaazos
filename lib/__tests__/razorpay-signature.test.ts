import crypto from "node:crypto";

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/env", () => ({
  requireEnv: (key: string) => {
    if (key !== "RAZORPAY_WEBHOOK_SECRET") {
      throw new Error(`Unexpected requireEnv(${key})`);
    }
    const v = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (v === undefined || v === "") {
      throw new Error("RAZORPAY_WEBHOOK_SECRET not set");
    }
    return v;
  },
}));

import { verifyRazorpaySignature } from "@/lib/razorpay";

describe("verifyRazorpaySignature", () => {
  const secret = "unit_test_whsec";

  beforeEach(() => {
    vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", secret);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns true for a valid HMAC (hex)", () => {
    const rawBody = '{"event":"subscription.activated","id":"evt_test"}';
    const sig = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
    expect(verifyRazorpaySignature(rawBody, sig)).toBe(true);
  });

  it("returns false when body was mutated", () => {
    const rawBody = '{"event":"subscription.activated","id":"evt_test"}';
    const sig = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
    expect(verifyRazorpaySignature(rawBody + " ", sig)).toBe(false);
  });

  it("returns false when signature was mutated", () => {
    const rawBody = '{"event":"subscription.activated","id":"evt_test"}';
    const sig = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
    const tampered = `${sig.slice(0, -1)}${sig.slice(-1) === "a" ? "b" : "a"}`;
    expect(verifyRazorpaySignature(rawBody, tampered)).toBe(false);
  });

  it("returns false for missing signature", () => {
    expect(verifyRazorpaySignature("{}", null)).toBe(false);
    expect(verifyRazorpaySignature("{}", undefined)).toBe(false);
  });
});
