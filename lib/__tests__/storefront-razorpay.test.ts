import crypto from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  requireEnv: (key: string) => {
    const v = process.env[key];
    if (v === undefined || v === "") throw new Error(`${key} not set`);
    return v;
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  accessTokenNeedsRefresh,
  checkoutKey,
  createRazorpayOrder,
  fetchRazorpayOrder,
  hasStoredRazorpayCreds,
  isOnlinePaymentEnabled,
  RAZORPAY_KEY_ID_PATTERN,
  RazorpayApiError,
  validateKeys,
  verifyCheckoutSignature,
  verifyWebhookSignature,
} from "@/lib/storefront-razorpay";

const hmac = (secret: string, data: string) => crypto.createHmac("sha256", secret).update(data).digest("hex");

describe("verifyCheckoutSignature", () => {
  const secret = "vendor_key_secret";
  const sig = hmac(secret, "order_ABC123|pay_XYZ789");

  it("accepts a correct signature", () => {
    expect(verifyCheckoutSignature("order_ABC123", "pay_XYZ789", sig, secret)).toBe(true);
    expect(verifyCheckoutSignature("order_ABC123", "pay_XYZ789", sig.toUpperCase(), secret)).toBe(true);
  });

  it("rejects wrong secret, swapped ids, tampering and junk", () => {
    expect(verifyCheckoutSignature("order_ABC123", "pay_XYZ789", sig, "other")).toBe(false);
    expect(verifyCheckoutSignature("order_ABC124", "pay_XYZ789", sig, secret)).toBe(false);
    expect(verifyCheckoutSignature("pay_XYZ789", "order_ABC123", sig, secret)).toBe(false);
    const tampered = `${sig.slice(0, -1)}${sig.endsWith("0") ? "1" : "0"}`;
    expect(verifyCheckoutSignature("order_ABC123", "pay_XYZ789", tampered, secret)).toBe(false);
    expect(verifyCheckoutSignature("order_ABC123", "pay_XYZ789", sig.slice(0, 32), secret)).toBe(false);
    expect(verifyCheckoutSignature("order_ABC123", "pay_XYZ789", "zz", secret)).toBe(false);
    expect(verifyCheckoutSignature("order_ABC123", "pay_XYZ789", "", secret)).toBe(false);
    expect(verifyCheckoutSignature("order_ABC123", "pay_XYZ789", null, secret)).toBe(false);
    expect(verifyCheckoutSignature("order_ABC123", "pay_XYZ789", sig, "")).toBe(false);
  });
});

describe("verifyWebhookSignature", () => {
  const secret = "whsec_vendor";
  const body = JSON.stringify({ event: "payment.captured", payload: {} });

  it("accepts the HMAC of the exact raw body", () => {
    expect(verifyWebhookSignature(body, hmac(secret, body), secret)).toBe(true);
  });

  it("rejects re-serialised body, wrong secret, missing header", () => {
    expect(verifyWebhookSignature(`${body} `, hmac(secret, body), secret)).toBe(false);
    expect(verifyWebhookSignature(body, hmac("nope", body), secret)).toBe(false);
    expect(verifyWebhookSignature(body, undefined, secret)).toBe(false);
    expect(verifyWebhookSignature(body, hmac(secret, body), "")).toBe(false);
  });
});

describe("helpers", () => {
  it("key id pattern", () => {
    expect(RAZORPAY_KEY_ID_PATTERN.test("rzp_test_1DP5mmOlF5G5ag")).toBe(true);
    expect(RAZORPAY_KEY_ID_PATTERN.test("rzp_live_ILgsfZCZoFIKMb")).toBe(true);
    expect(RAZORPAY_KEY_ID_PATTERN.test("rzp_prod_ILgsfZCZoFIKMb")).toBe(false);
    expect(RAZORPAY_KEY_ID_PATTERN.test("sk_test_123")).toBe(false);
  });

  it("hasStoredRazorpayCreds needs all three", () => {
    expect(
      hasStoredRazorpayCreds({ razorpayKeyId: "rzp_test_x", razorpayKeySecretEnc: "v1:a", razorpayWebhookSecretEnc: "v1:b" }),
    ).toBe(true);
    expect(
      hasStoredRazorpayCreds({ razorpayKeyId: "rzp_test_x", razorpayKeySecretEnc: "v1:a", razorpayWebhookSecretEnc: null }),
    ).toBe(false);
    expect(hasStoredRazorpayCreds(null)).toBe(false);
  });
});

describe("HTTP (mocked fetch)", () => {
  const creds = { kind: "keys" as const, keyId: "rzp_test_abcdefgh12", keySecret: "sek" };
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("validateKeys: 200 → true, 401 → false, 500 → throws", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await expect(validateKeys(creds)).resolves.toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.razorpay.com/v1/orders?count=1");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from("rzp_test_abcdefgh12:sek").toString("base64")}`,
    );
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 401 }));
    await expect(validateKeys(creds)).resolves.toBe(false);
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    await expect(validateKeys(creds)).rejects.toBeInstanceOf(RazorpayApiError);
  });

  it("createRazorpayOrder sends integer paise and refuses non-integers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "order_TEST123456", amount: 12345, status: "created", currency: "INR" }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const o = await createRazorpayOrder({
      creds,
      amountPaise: 12345,
      receipt: "AWZ-20261005-0001",
      notes: { transactionId: "t1", vendorId: "v1" },
    });
    expect(o.id).toBe("order_TEST123456");
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body).toEqual({
      amount: 12345,
      currency: "INR",
      receipt: "AWZ-20261005-0001",
      notes: { transactionId: "t1", vendorId: "v1" },
    });
    await expect(
      createRazorpayOrder({ creds, amountPaise: 123.5, receipt: "r", notes: { transactionId: "t", vendorId: "v" } }),
    ).rejects.toBeInstanceOf(RazorpayApiError);
  });
});

describe("isOnlinePaymentEnabled", () => {
  const NOW = new Date("2026-10-13T06:00:00.000Z");
  const DAY_MS = 24 * 60 * 60 * 1000;
  const creds = { razorpayKeyId: "rzp_test_x", razorpayKeySecretEnc: "v1:a", razorpayWebhookSecretEnc: "v1:b" };
  const inTrial = new Date(NOW.getTime() + 10 * DAY_MS);
  const trialOver = new Date(NOW.getTime() - 10 * DAY_MS);

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is on from STARTER, including the free trial; off for FREE and a locked vendor", () => {
    vi.stubEnv("PAYMENT_KEYS_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
    expect(isOnlinePaymentEnabled({ plan: "STARTER", planExpiresAt: null }, creds, NOW)).toBe(true);
    expect(isOnlinePaymentEnabled({ plan: "PRO", planExpiresAt: null }, creds, NOW)).toBe(true);
    expect(isOnlinePaymentEnabled({ plan: "FREE", planExpiresAt: null, trialEndsAt: inTrial }, creds, NOW)).toBe(true);
    expect(isOnlinePaymentEnabled({ plan: "FREE", planExpiresAt: null, trialEndsAt: trialOver }, creds, NOW)).toBe(false);
    expect(isOnlinePaymentEnabled({ plan: "FREE", planExpiresAt: null, trialEndsAt: null }, creds, NOW)).toBe(false);
  });

  it("needs saved keys and the encryption key on this deploy", () => {
    const starter = { plan: "STARTER" as const, planExpiresAt: null };
    vi.stubEnv("PAYMENT_KEYS_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
    expect(isOnlinePaymentEnabled(starter, null, NOW)).toBe(false);
    vi.stubEnv("PAYMENT_KEYS_ENCRYPTION_KEY", "");
    expect(isOnlinePaymentEnabled(starter, creds, NOW)).toBe(false);
  });
});

describe("Connect Razorpay (OAuth) creds", () => {
  const NOW = new Date("2026-10-30T06:00:00.000Z");
  const DAY_MS = 24 * 60 * 60 * 1000;
  const oauth = {
    razorpayAccountId: "acc_Dhk2qDbmu6FwZH",
    razorpayAccessTokenEnc: "v1:a",
    razorpayRefreshTokenEnc: "v1:r",
    razorpayPublicToken: "rzp_test_oauth_9xu1rkZqoXlClS",
    razorpayTokenExpiresAt: new Date(NOW.getTime() + 60 * DAY_MS),
    razorpayRefreshExpiresAt: new Date(NOW.getTime() + 150 * DAY_MS),
  };
  const starter = { plan: "STARTER" as const, planExpiresAt: null };

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("counts as stored while the refresh token is alive", () => {
    expect(hasStoredRazorpayCreds(oauth, NOW)).toBe(true);
    expect(hasStoredRazorpayCreds({ ...oauth, razorpayRefreshExpiresAt: new Date(NOW.getTime() - DAY_MS) }, NOW)).toBe(false);
    expect(hasStoredRazorpayCreds({ ...oauth, razorpayAccessTokenEnc: null }, NOW)).toBe(false);
  });

  it("online pay needs the partner app configured on this deploy", () => {
    vi.stubEnv("PAYMENT_KEYS_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
    vi.stubEnv("RAZORPAY_OAUTH_CLIENT_ID", "");
    vi.stubEnv("RAZORPAY_OAUTH_CLIENT_SECRET", "");
    expect(isOnlinePaymentEnabled(starter, oauth, NOW)).toBe(false);
    vi.stubEnv("RAZORPAY_OAUTH_CLIENT_ID", "cid");
    vi.stubEnv("RAZORPAY_OAUTH_CLIENT_SECRET", "csec");
    expect(isOnlinePaymentEnabled(starter, oauth, NOW)).toBe(true);
    expect(isOnlinePaymentEnabled({ plan: "FREE", planExpiresAt: null, trialEndsAt: null }, oauth, NOW)).toBe(false);
  });

  it("refreshes inside the last 7 days of the access token", () => {
    expect(accessTokenNeedsRefresh(new Date(NOW.getTime() + 8 * DAY_MS), NOW)).toBe(false);
    expect(accessTokenNeedsRefresh(new Date(NOW.getTime() + 6 * DAY_MS), NOW)).toBe(true);
    expect(accessTokenNeedsRefresh(null, NOW)).toBe(true);
  });

  it("calls Razorpay with a Bearer token and gives Checkout the public token", async () => {
    const creds = { kind: "oauth" as const, accessToken: "tok_abc", publicToken: oauth.razorpayPublicToken, accountId: oauth.razorpayAccountId };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "order_TEST123456", amount: 100, status: "paid", amount_paid: 100 }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const o = await fetchRazorpayOrder(creds, "order_TEST123456");
    expect(o.status).toBe("paid");
    expect(((fetchMock.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>).Authorization).toBe(
      "Bearer tok_abc",
    );
    expect(checkoutKey(creds)).toBe("rzp_test_oauth_9xu1rkZqoXlClS");
    expect(checkoutKey({ kind: "keys", keyId: "rzp_test_abcdefgh12", keySecret: "s" })).toBe("rzp_test_abcdefgh12");
  });
});
