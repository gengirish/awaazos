import { createHmac } from "node:crypto";

import { expect, test } from "@playwright/test";

import { createVendorSession } from "./helpers/vendor";

/**
 * Routes a machine calls with a secret instead of a session: the Razorpay
 * webhooks (HMAC, verified before any database work), the two daily Vercel
 * Crons (`Bearer $CRON_SECRET`) and the internal demo-store API
 * (`x-internal-api-key`). Each must refuse a missing or wrong secret.
 *
 * The "right secret" cases sign with the same env var the server reads, so
 * they run only when the test process has it too (CI sets dummy values on the
 * E2E job); without it they skip and the refusal cases still run.
 */

const sign = (body: string, secret: string) => createHmac("sha256", secret).update(body, "utf8").digest("hex");
const json = { "Content-Type": "application/json" };

test.describe("Razorpay platform subscription webhook", () => {
  const url = "/api/webhooks/razorpay";
  const body = JSON.stringify({ event: "payment.authorized", payload: {} });

  test("no signature → 401", async ({ request }) => {
    const res = await request.post(url, { data: body, headers: json });
    expect(res.status()).toBe(401);
  });

  test("wrong signature → 401; right signature on an irrelevant event → 200 ack", async ({ request }) => {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    test.skip(!secret, "RAZORPAY_WEBHOOK_SECRET not set in the test env");

    const forged = await request.post(url, {
      data: body,
      headers: { ...json, "x-razorpay-signature": sign(body, `${secret}-wrong`) },
    });
    expect(forged.status()).toBe(401);

    const notHex = await request.post(url, { data: body, headers: { ...json, "x-razorpay-signature": "zz" } });
    expect(notHex.status()).toBe(401);

    const ok = await request.post(url, {
      data: body,
      headers: { ...json, "x-razorpay-signature": sign(body, secret!) },
    });
    expect(ok.status()).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });
  });
});

test.describe("Razorpay per-store order webhook", () => {
  const body = JSON.stringify({ event: "payment.captured", payload: {} });

  test("unknown store, store with no secret and bad path all look the same (400 invalid_signature)", async ({
    page,
    request,
  }) => {
    await createVendorSession(page, request, "rzp-wh");
    const me = await page.request.get("/api/vendor");
    const { vendor } = (await me.json()) as { vendor: { id: string } };

    const headers = { ...json, "x-razorpay-signature": sign(body, "anything") };
    const responses = await Promise.all([
      request.post(`/api/webhooks/razorpay-orders/${vendor.id}`, { data: body, headers }),
      request.post("/api/webhooks/razorpay-orders/cnotarealvendor0000000000", { data: body, headers }),
      request.post("/api/webhooks/razorpay-orders/bad!id", { data: body, headers }),
      request.post(`/api/webhooks/razorpay-orders/${vendor.id}`, { data: body, headers: json }),
    ]);
    for (const res of responses) {
      expect(res.status()).toBe(400);
      // Identical bodies: an attacker can't tell which store ids exist.
      expect(await res.json()).toEqual({ error: "invalid_signature" });
    }
  });
});

test.describe("Razorpay partner webhook", () => {
  const url = "/api/webhooks/razorpay-partner";
  const body = JSON.stringify({ event: "payment.captured", payload: {} });

  test("refuses anything unsigned; signed without an account id is acknowledged", async ({ request }) => {
    const secret = process.env.RAZORPAY_PARTNER_WEBHOOK_SECRET;
    const unsigned = await request.post(url, { data: body, headers: json });
    if (!secret) {
      // Fails closed when the platform secret isn't configured.
      expect(unsigned.status()).toBe(503);
      return;
    }
    expect(unsigned.status()).toBe(400);

    const forged = await request.post(url, {
      data: body,
      headers: { ...json, "x-razorpay-signature": sign(body, `${secret}-wrong`) },
    });
    expect(forged.status()).toBe(400);
    expect(await forged.json()).toEqual({ error: "invalid_signature" });

    const ok = await request.post(url, { data: body, headers: { ...json, "x-razorpay-signature": sign(body, secret) } });
    expect(ok.status()).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });
  });
});

test.describe("Vercel Cron routes", () => {
  for (const path of ["/api/cron/retention", "/api/cron/trial-reminders"]) {
    test(`${path} refuses no token and a wrong token (401)`, async ({ request }) => {
      const none = await request.get(path);
      expect(none.status()).toBe(401);
      const wrong = await request.get(path, { headers: { Authorization: "Bearer not-the-cron-secret" } });
      expect(wrong.status()).toBe(401);
      const bare = await request.get(path, { headers: { Authorization: process.env.CRON_SECRET ?? "x" } });
      expect(bare.status(), "the secret without 'Bearer ' is still refused").toBe(401);
    });
  }

  test("retention runs with the right token", async ({ request }) => {
    const secret = process.env.CRON_SECRET;
    test.skip(!secret, "CRON_SECRET not set in the test env");
    const res = await request.get("/api/cron/retention", { headers: { Authorization: `Bearer ${secret}` } });
    expect(res.status()).toBe(200);
    const { data } = (await res.json()) as { data: Record<string, unknown> };
    expect(data).toBeTruthy();
  });
});

test.describe("internal demo-store API", () => {
  test("refuses a missing or wrong x-internal-api-key (401), whatever the body", async ({ request }) => {
    const calls = [
      request.post("/api/internal/demo-stores", { data: {}, headers: json }),
      request.post("/api/internal/demo-stores", {
        data: {},
        headers: { ...json, "x-internal-api-key": "k".repeat(40) },
      }),
      request.get("/api/internal/demo-stores/e2e-ref", { headers: { "x-internal-api-key": "" } }),
      request.post("/api/internal/demo-stores/e2e-ref/handover", {
        data: {},
        headers: { ...json, "x-internal-api-key": "short" },
      }),
    ];
    for (const res of await Promise.all(calls)) expect(res.status()).toBe(401);
  });
});
