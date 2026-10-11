import crypto from "node:crypto";

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/env", () => ({
  requireEnv: (key: string) => {
    if (key !== "RAZORPAY_WEBHOOK_SECRET" && key !== "RAZORPAY_KEY_SECRET") {
      throw new Error(`Unexpected requireEnv(${key})`);
    }
    const v = process.env[key];
    if (v === undefined || v === "") {
      throw new Error(`${key} not set`);
    }
    return v;
  },
}));

import { verifyRazorpaySignature, verifySubscriptionPaymentSignature } from "@/lib/razorpay";

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

describe("verifySubscriptionPaymentSignature", () => {
  const keySecret = "unit_test_key_secret";
  const paymentId = "pay_Unit123";
  const subId = "sub_Unit456";
  const sign = (data: string, secret = keySecret) =>
    crypto.createHmac("sha256", secret).update(data, "utf8").digest("hex");

  beforeEach(() => {
    vi.stubEnv("RAZORPAY_KEY_SECRET", keySecret);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts HMAC(payment_id|subscription_id) with the key secret", () => {
    expect(verifySubscriptionPaymentSignature(paymentId, subId, sign(`${paymentId}|${subId}`))).toBe(true);
  });

  it("rejects the Orders ordering (subscription_id|payment_id)", () => {
    expect(verifySubscriptionPaymentSignature(paymentId, subId, sign(`${subId}|${paymentId}`))).toBe(false);
  });

  it("rejects a signature for another subscription or payment", () => {
    const sig = sign(`${paymentId}|${subId}`);
    expect(verifySubscriptionPaymentSignature(paymentId, "sub_Other", sig)).toBe(false);
    expect(verifySubscriptionPaymentSignature("pay_Other", subId, sig)).toBe(false);
  });

  it("rejects a signature made with the webhook secret or any other key", () => {
    expect(verifySubscriptionPaymentSignature(paymentId, subId, sign(`${paymentId}|${subId}`, "other"))).toBe(false);
  });

  it("rejects missing, empty, non-hex and wrong-length signatures without throwing", () => {
    expect(verifySubscriptionPaymentSignature(paymentId, subId, null)).toBe(false);
    expect(verifySubscriptionPaymentSignature(paymentId, subId, "")).toBe(false);
    expect(verifySubscriptionPaymentSignature(paymentId, subId, "not-hex!")).toBe(false);
    expect(verifySubscriptionPaymentSignature(paymentId, subId, "abcd")).toBe(false);
    expect(verifySubscriptionPaymentSignature("", subId, sign(`|${subId}`))).toBe(false);
  });
});
