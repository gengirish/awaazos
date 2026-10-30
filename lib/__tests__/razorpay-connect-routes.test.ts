/**
 * "Connect Razorpay" callback and the partner webhook — handler tests with auth,
 * Prisma and Razorpay mocked. No DB, no network.
 */
import crypto from "node:crypto";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  memberVendorId: "vendor_a",
  upsert: vi.fn(),
  updateMany: vi.fn(),
  findFirst: vi.fn(),
  transaction: vi.fn(),
  markOrderPaid: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  requireEnv: (key: string) => {
    const v = process.env[key];
    if (v === undefined || v === "") throw new Error(`${key} not set`);
    return v;
  },
}));

vi.mock("@/lib/rbac", () => {
  class AuthError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  }
  class PlanGateError extends AuthError {}
  return {
    AuthError,
    PlanGateError,
    requirePlan: () => {},
    // Like the real one: an unknown target falls back to the user's own vendor.
    requireVendorRole: vi.fn(async () => ({ vendor: { id: h.memberVendorId, plan: "STARTER" }, setVendorCookie: null })),
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    vendorSettings: { upsert: h.upsert, updateMany: h.updateMany },
    transaction: { findFirst: h.findFirst },
    $transaction: h.transaction,
  },
}));

vi.mock("@/lib/drops", () => ({ markOrderPaid: h.markOrderPaid }));

vi.mock("@/lib/ratelimit", () => ({
  webhookRateLimit: { check: async () => ({ ok: true }) },
  writeRateLimit: { check: async () => ({ ok: true }) },
  getClientIp: () => "1.2.3.4",
  tooManyRequests: () => new Response("{}", { status: 429 }),
}));

import { GET as callback } from "@/app/api/vendor/payments/razorpay/callback/route";
import { POST as partnerWebhook } from "@/app/api/webhooks/razorpay-partner/route";
import { createOauthState, OAUTH_STATE_COOKIE } from "@/lib/razorpay-oauth";

const TOKEN_JSON = {
  expires_in: 7862400,
  access_token: "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.access",
  refresh_token: "def50200refreshtokenvalue",
  public_token: "rzp_test_oauth_9xu1rkZqoXlClS",
  razorpay_account_id: "acc_Dhk2qDbmu6FwZH",
};

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", "test-auth-secret-at-least-32-chars-long");
  vi.stubEnv("AUTH_URL", "https://app.example");
  vi.stubEnv("RAZORPAY_OAUTH_CLIENT_ID", "cid");
  vi.stubEnv("RAZORPAY_OAUTH_CLIENT_SECRET", "csec");
  vi.stubEnv("RAZORPAY_PARTNER_WEBHOOK_SECRET", "partner-secret");
  vi.stubEnv("PAYMENT_KEYS_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
  h.memberVendorId = "vendor_a";
  for (const fn of [h.upsert, h.updateMany, h.findFirst, h.transaction, h.markOrderPaid]) fn.mockReset();
  h.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({}));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function callbackReq(query: Record<string, string>, nonce?: string) {
  const req = new NextRequest(`https://app.example/api/vendor/payments/razorpay/callback?${new URLSearchParams(query)}`);
  if (nonce) req.cookies.set(OAUTH_STATE_COOKIE, nonce);
  return req;
}

function outcome(res: Response): string | null {
  return new URL(res.headers.get("location") ?? "").searchParams.get("razorpay");
}

describe("GET /api/vendor/payments/razorpay/callback", () => {
  it("stores encrypted tokens, clears pasted keys and redirects back", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(TOKEN_JSON), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { state, nonce } = createOauthState("vendor_a");
    const res = await callback(callbackReq({ code: "authcode", state }, nonce));

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://app.example/settings/payments?razorpay=connected");
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.redirect_uri).toBe("https://app.example/api/vendor/payments/razorpay/callback");

    const arg = h.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ vendorId: "vendor_a" });
    expect(arg.update.razorpayAccountId).toBe("acc_Dhk2qDbmu6FwZH");
    expect(arg.update.razorpayPublicToken).toBe("rzp_test_oauth_9xu1rkZqoXlClS");
    expect(arg.update.razorpayKeyId).toBeNull();
    expect(arg.update.razorpayAccessTokenEnc).not.toContain(TOKEN_JSON.access_token);
    expect(arg.update.razorpayRefreshTokenEnc).not.toContain(TOKEN_JSON.refresh_token);
  });

  it("cross-tenant: a state for another vendor attaches nothing", async () => {
    vi.stubGlobal("fetch", vi.fn());
    h.memberVendorId = "vendor_b"; // signed in as B; the state names A
    const { state, nonce } = createOauthState("vendor_a");
    const res = await callback(callbackReq({ code: "authcode", state }, nonce));
    expect(outcome(res)).toBe("owner_only");
    expect(h.upsert).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("forged or cookie-less state, and a refusal on Razorpay, change nothing", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const { state, nonce } = createOauthState("vendor_a");
    expect(outcome(await callback(callbackReq({ code: "c", state })))).toBe("expired");
    expect(outcome(await callback(callbackReq({ code: "c", state: `${state}x` }, nonce)))).toBe("expired");
    expect(outcome(await callback(callbackReq({ error: "access_denied", state }, nonce)))).toBe("denied");
    expect(h.upsert).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a failed code exchange redirects with error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 400 })));
    const { state, nonce } = createOauthState("vendor_a");
    expect(outcome(await callback(callbackReq({ code: "c", state }, nonce)))).toBe("error");
    expect(h.upsert).not.toHaveBeenCalled();
  });
});

function signed(body: unknown, secret = "partner-secret") {
  const raw = JSON.stringify(body);
  const sig = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  return new Request("https://app.example/api/webhooks/razorpay-partner", {
    method: "POST",
    headers: { "x-razorpay-signature": sig },
    body: raw,
  });
}

const PAID_EVENT = {
  event: "payment.captured",
  account_id: "acc_Dhk2qDbmu6FwZH",
  payload: {
    payment: { entity: { id: "pay_ABC123456", order_id: "order_XYZ123456", amount: 25000, currency: "INR" } },
  },
};

describe("POST /api/webhooks/razorpay-partner", () => {
  it("bad signature → 400 before any database access", async () => {
    const res = await partnerWebhook(signed(PAID_EVENT, "wrong-secret"));
    expect(res.status).toBe(400);
    expect(h.findFirst).not.toHaveBeenCalled();
    expect(h.updateMany).not.toHaveBeenCalled();
  });

  it("503 when the secret isn't configured", async () => {
    vi.stubEnv("RAZORPAY_PARTNER_WEBHOOK_SECRET", "");
    expect((await partnerWebhook(signed(PAID_EVENT))).status).toBe(503);
  });

  it("marks the order paid, matching only within the named Razorpay account", async () => {
    h.findFirst.mockResolvedValue({ id: "txn_1", vendorId: "vendor_a", totalPaise: 25000, paymentStatus: "PENDING" });
    h.markOrderPaid.mockResolvedValue(true);
    const res = await partnerWebhook(signed(PAID_EVENT));
    expect(res.status).toBe(200);
    expect(h.findFirst.mock.calls[0][0].where).toEqual({
      razorpayOrderId: "order_XYZ123456",
      source: "STOREFRONT",
      vendor: { settings: { is: { razorpayAccountId: "acc_Dhk2qDbmu6FwZH" } } },
    });
    expect(h.markOrderPaid).toHaveBeenCalledWith(expect.anything(), {
      vendorId: "vendor_a",
      transactionId: "txn_1",
      razorpayOrderId: "order_XYZ123456",
      razorpayPaymentId: "pay_ABC123456",
    });
  });

  it("an amount mismatch is acknowledged but not marked paid", async () => {
    h.findFirst.mockResolvedValue({ id: "txn_1", vendorId: "vendor_a", totalPaise: 99900, paymentStatus: "PENDING" });
    expect((await partnerWebhook(signed(PAID_EVENT))).status).toBe(200);
    expect(h.markOrderPaid).not.toHaveBeenCalled();
  });

  it("revoke clears the OAuth columns of that account's stores", async () => {
    h.updateMany.mockResolvedValue({ count: 1 });
    const res = await partnerWebhook(
      signed({ event: "account.app.authorization_revoked", account_id: "acc_Dhk2qDbmu6FwZH", contains: [] }),
    );
    expect(res.status).toBe(200);
    const arg = h.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ razorpayAccountId: "acc_Dhk2qDbmu6FwZH" });
    expect(arg.data.razorpayAccessTokenEnc).toBeNull();
    expect(arg.data.razorpayAccountId).toBeNull();
  });

  it("no account_id → acknowledged, nothing touched", async () => {
    const res = await partnerWebhook(signed({ ...PAID_EVENT, account_id: undefined }));
    expect(res.status).toBe(200);
    expect(h.findFirst).not.toHaveBeenCalled();
  });
});
