import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { createMenuItem, createVendorSession, type TransactionCreated } from "./helpers/vendor";

/**
 * Offline counter sales (docs/PWA_OFFLINE_PLAN.md).
 *
 * UI: /pos opens from the service worker cache with no network, sales are
 * queued in IndexedDB as "Offline #N", and they sync exactly once when the
 * network returns. API: the server dedupes on clientRef, buckets a deferred
 * sale to the day it was rung up, and never files it under another vendor.
 */

const CHAI = { name: "Cutting Chai", priceInRupees: 10 };

async function vendorId(page: Page): Promise<string> {
  const res = await page.request.get("/api/vendor");
  expect(res.status()).toBe(200);
  return ((await res.json()) as { vendor: { id: string } }).vendor.id;
}

function saleBody(over: Record<string, unknown> = {}) {
  return {
    items: [{ name: CHAI.name, priceInPaise: 1000, qty: 1 }],
    subtotalPaise: 1000,
    taxPaise: 0,
    totalPaise: 1000,
    paymentMethod: "CASH",
    ...over,
  };
}

/** Today in IST as YYYYMMDD, shifted by `days`. */
function istYmd(days = 0): string {
  const d = new Date(Date.now() + days * 86_400_000);
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)!.value;
  return `${get("year")}${get("month")}${get("day")}`;
}

async function cashSale(page: Page): Promise<void> {
  await page.getByRole("button", { name: new RegExp(`^${CHAI.name}`) }).click();
  await page.getByRole("button", { name: "Collect payment" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Cash" }).click();
  await dialog.getByRole("button", { name: /Mark as paid/ }).click();
}

test.describe("POS offline", () => {
  // Service workers and context-wide offline emulation are Chromium features.
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium only");

  test("rings up sales offline and syncs each exactly once when back online", async ({
    page,
    context,
    request,
  }) => {
    await createVendorSession(page, request, "posoffline");
    await createMenuItem(page, CHAI);

    // First visit registers /sw.js; the reload goes through it, which caches
    // the /pos page and every chunk it references.
    await page.goto("/pos");
    await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 30_000 });
    await page.reload();
    await expect
      .poll(() => page.evaluate(async () => Boolean(await caches.match("/pos", { ignoreSearch: true }))), {
        timeout: 30_000,
      })
      .toBe(true);

    await context.setOffline(true);
    await page.reload();

    await expect(page.getByText(/Offline\./)).toBeVisible();
    await expect(page.getByRole("button", { name: "Voice needs internet — tap items below" })).toBeDisabled();

    for (let n = 1; n <= 3; n++) {
      await cashSale(page);
      await expect(page.getByText(`Offline #${n}`)).toBeVisible();
      await page.getByRole("button", { name: /New order/ }).click();
    }
    await expect(page.getByText("3 sales waiting to sync")).toBeVisible();
    // ₹30 of today's revenue exists only on this phone so far.
    await expect(page.getByText("incl. ₹30.00 not yet synced")).toBeVisible();

    await context.setOffline(false);
    await expect(page.getByText(/sales? waiting to sync/)).toHaveCount(0, { timeout: 30_000 });

    const list = await page.request.get("/api/transactions?limit=50");
    expect(list.status()).toBe(200);
    const { items } = (await list.json()) as { items: { billNumber: string; totalPaise: number }[] };
    expect(items).toHaveLength(3);
    const bills = items.map((i) => i.billNumber);
    expect(new Set(bills).size).toBe(3);
    for (const b of bills) expect(b).toMatch(/^AWZ-\d{8}-\d{4}$/);
  });
});

test.describe("POST /api/transactions — offline outbox contract", () => {
  test("a replayed clientRef returns the original bill with 200, not a new sale", async ({ page, request }) => {
    await createVendorSession(page, request, "outbox-replay");
    const id = await vendorId(page);
    const clientRef = randomUUID();
    const body = saleBody({ clientRef, vendorId: id, clientCreatedAt: new Date().toISOString(), deferred: true });

    const first = await page.request.post("/api/transactions", { data: body });
    expect(first.status()).toBe(201);
    const created = (await first.json()) as TransactionCreated;

    // A different Idempotency-Key (or none) still can't mint a second bill.
    const replay = await page.request.post("/api/transactions", { data: body });
    expect(replay.status()).toBe(200);
    expect(((await replay.json()) as TransactionCreated).transaction.billNumber).toBe(
      created.transaction.billNumber,
    );

    const list = await page.request.get("/api/transactions?limit=50");
    expect(((await list.json()) as { total: number }).total).toBe(1);
  });

  test("a deferred sale from yesterday gets yesterday's bill date", async ({ page, request }) => {
    await createVendorSession(page, request, "outbox-yday");
    const id = await vendorId(page);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();

    const res = await page.request.post("/api/transactions", {
      data: saleBody({ clientRef: randomUUID(), vendorId: id, clientCreatedAt: yesterday, deferred: true }),
    });
    expect(res.status()).toBe(201);
    const { transaction } = (await res.json()) as TransactionCreated & {
      transaction: { createdAt: string };
    };
    expect(transaction.billNumber).toMatch(new RegExp(`^AWZ-${istYmd(-1)}-\\d{4}$`));
    expect(new Date(transaction.createdAt).toISOString()).toBe(yesterday);
  });

  test("deferred sales outside the accepted window are rejected with 422", async ({ page, request }) => {
    await createVendorSession(page, request, "outbox-window");
    const id = await vendorId(page);

    const tooOld = await page.request.post("/api/transactions", {
      data: saleBody({
        clientRef: randomUUID(),
        vendorId: id,
        clientCreatedAt: new Date(Date.now() - 8 * 86_400_000).toISOString(),
        deferred: true,
      }),
    });
    expect(tooOld.status()).toBe(422);
    expect(((await tooOld.json()) as { code: string }).code).toBe("client_time_too_old");

    const future = await page.request.post("/api/transactions", {
      data: saleBody({
        clientRef: randomUUID(),
        vendorId: id,
        clientCreatedAt: new Date(Date.now() + 60 * 60_000).toISOString(),
        deferred: true,
      }),
    });
    expect(future.status()).toBe(422);
  });

  test("a sale queued for another vendor is refused with 404, never filed under this one", async ({
    page,
    request,
  }) => {
    await createVendorSession(page, request, "outbox-tenant");

    const res = await page.request.post("/api/transactions?vendor=someone-else", {
      data: saleBody({ clientRef: randomUUID(), vendorId: "someone-else", deferred: false }),
    });
    expect(res.status()).toBe(404);

    const list = await page.request.get("/api/transactions?limit=50");
    expect(((await list.json()) as { total: number }).total).toBe(0);
  });
});
