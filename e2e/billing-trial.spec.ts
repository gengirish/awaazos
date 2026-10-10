import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { CAN_SET_BILLING, daysFromNow, makeGrandfatheredFree, setVendorBilling } from "./helpers/billing-db";
import { createMenuItem, createVendorSession } from "./helpers/vendor";

/**
 * Free trial and lock (docs/RAZORPAY_SUBSCRIPTIONS_PLAN.md, lib/plan.ts).
 * State is derived lazily from Vendor.trialEndsAt / plan / planExpiresAt on
 * every request, so moving those dates in the database is all it takes.
 */

function saleBody(item: { id: string; name: string; priceInPaise: number }, extra: Record<string, unknown> = {}) {
  return {
    items: [{ menuItemId: item.id, name: item.name, priceInPaise: item.priceInPaise, qty: 1 }],
    subtotalPaise: item.priceInPaise,
    discountPaise: 0,
    taxPaise: 0,
    totalPaise: item.priceInPaise,
    paymentMethod: "CASH",
    source: "MANUAL",
    ...extra,
  };
}

const JSON_HEADERS = { "Content-Type": "application/json" };

test.describe("free trial", () => {
  test("a new vendor starts on a 30-day trial with Starter features", async ({ page, request }) => {
    await createVendorSession(page, request, "trial-new", "/settings/billing");

    await expect(page.getByText(/starter — free trial/i)).toBeVisible();
    await expect(page.getByText(/30 of 30 days left/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /^starter monthly/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^starter yearly/i })).toBeVisible();

    // CSV export is a Starter feature: the plan gate lets a trial vendor through.
    const csv = await page.request.get("/api/transactions/export?from=2026-01-01&to=2026-12-31");
    expect(csv.status()).toBe(200);

    // No "trial ending" strip this early.
    await page.goto("/pos");
    await expect(page.getByText(/free trial ends/i)).toHaveCount(0);
  });

  test.describe("with billing state set in the database", () => {
    test.skip(!CAN_SET_BILLING, "needs a local throwaway database to move the trial dates");

    test("the till warns in the last days of the trial", async ({ page, request }) => {
      const creds = await createVendorSession(page, request, "trial-ending");
      await setVendorBilling(creds.email, { trialEndsAt: daysFromNow(2.5) });

      await page.goto("/pos");
      const notice = page.getByRole("status").filter({ hasText: /free trial ends/i });
      await expect(notice).toContainText("in 3 days");
      await expect(notice.getByRole("link", { name: /choose a plan/i })).toHaveAttribute("href", "/settings/billing");
    });

    test("after the trial the till is locked, records stay reachable, and subscribing is offered", async ({
      page,
      request,
    }) => {
      const creds = await createVendorSession(page, request, "trial-over");
      const item = await createMenuItem(page, { name: "Trial Chai", priceInRupees: 15 });

      const during = await page.request.post("/api/transactions", { data: saleBody(item), headers: JSON_HEADERS });
      expect(during.status()).toBe(201);

      await setVendorBilling(creds.email, { trialEndsAt: daysFromNow(-1) });

      // New sales are refused with the stable code the POS switches on.
      const after = await page.request.post("/api/transactions", { data: saleBody(item), headers: JSON_HEADERS });
      expect(after.status()).toBe(402);
      expect(((await after.json()) as { error: string }).error).toBe("billing_locked");

      // AI spend is refused too.
      const parse = await page.request.post("/api/ai/parse-order", {
        data: { transcript: "ek chai", lang: "en-IN" },
        headers: JSON_HEADERS,
      });
      expect(parse.status()).toBe(402);

      // The till is replaced by the lock card.
      await page.goto("/pos");
      await expect(page.getByRole("heading", { name: /subscribe to keep selling/i })).toBeVisible();
      await expect(page.getByRole("link", { name: /choose a plan/i })).toHaveAttribute("href", "/settings/billing");

      // Records stay reachable: the bill list, and CSV export despite the plan gate.
      const list = await page.request.get("/api/transactions");
      expect(list.status()).toBe(200);
      expect(((await list.json()) as { total: number }).total).toBe(1);
      const csv = await page.request.get("/api/transactions/export?from=2026-01-01&to=2026-12-31");
      expect(csv.status()).toBe(200);

      // Billing explains the state and offers both plans.
      await page.goto("/settings/billing");
      await expect(page.getByText(/no active plan/i)).toBeVisible();
      await expect(page.getByRole("button", { name: /^starter monthly/i })).toBeVisible();
      await expect(page.getByRole("button", { name: /^starter yearly/i })).toBeVisible();
    });

    test("an offline sale rung up before the lock still syncs; one rung up after does not", async ({
      page,
      request,
    }) => {
      const creds = await createVendorSession(page, request, "trial-offline");
      const item = await createMenuItem(page, { name: "Offline Vada", priceInRupees: 20 });
      await setVendorBilling(creds.email, { trialEndsAt: daysFromNow(-1) });

      const before = await page.request.post("/api/transactions", {
        data: saleBody(item, {
          deferred: true,
          clientRef: randomUUID(),
          clientCreatedAt: daysFromNow(-2).toISOString(),
        }),
        headers: JSON_HEADERS,
      });
      expect(before.status()).toBe(201);

      const afterLock = await page.request.post("/api/transactions", {
        data: saleBody(item, {
          deferred: true,
          clientRef: randomUUID(),
          clientCreatedAt: new Date(Date.now() - 60_000).toISOString(),
        }),
        headers: JSON_HEADERS,
      });
      expect(afterLock.status()).toBe(402);
    });

    test("a paid plan unlocks a vendor whose trial has ended", async ({ page, request }) => {
      const creds = await createVendorSession(page, request, "trial-paid");
      const item = await createMenuItem(page, { name: "Paid Samosa", priceInRupees: 20 });
      await setVendorBilling(creds.email, {
        trialEndsAt: daysFromNow(-10),
        plan: "STARTER",
        planExpiresAt: daysFromNow(20),
      });

      const sale = await page.request.post("/api/transactions", { data: saleBody(item), headers: JSON_HEADERS });
      expect(sale.status()).toBe(201);
      await page.goto("/pos");
      await expect(page.getByRole("heading", { name: /subscribe to keep selling/i })).toHaveCount(0);
    });

    test("a vendor from before the trial stays on FREE and is never locked", async ({ page, request }) => {
      const creds = await createVendorSession(page, request, "trial-grandfathered");
      const item = await createMenuItem(page, { name: "Old Idli", priceInRupees: 30 });
      await makeGrandfatheredFree(creds.email);

      const sale = await page.request.post("/api/transactions", { data: saleBody(item), headers: JSON_HEADERS });
      expect(sale.status()).toBe(201);
      await page.goto("/settings/billing");
      await expect(page.getByText("Free", { exact: true })).toBeVisible();
      await expect(page.getByText(/no active plan/i)).toHaveCount(0);
    });
  });
});
