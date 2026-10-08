import { describe, expect, it } from "vitest";

import { formatBillDateYYYYMMDD, getIstTodayStart } from "@/lib/billing-period";
import {
  MAX_CLIENT_CLOCK_SKEW_MS,
  MAX_DEFERRED_SALE_AGE_MS,
  resolveSaleTime,
  transactionPostBodySchema,
} from "@/lib/transaction-post-body";

const NOW = new Date("2026-10-07T06:30:00.000Z"); // 12:00 IST

describe("resolveSaleTime", () => {
  it("uses the server clock for a live checkout, ignoring any client time", () => {
    const r = resolveSaleTime({ clientCreatedAt: "2026-10-01T00:00:00.000Z" }, NOW);
    expect(r).toEqual({ ok: true, saleAt: NOW, fromClient: false });
  });

  it("uses the device time for a deferred sale", () => {
    const r = resolveSaleTime({ deferred: true, clientCreatedAt: "2026-10-06T10:00:00.000Z" }, NOW);
    expect(r).toEqual({ ok: true, saleAt: new Date("2026-10-06T10:00:00.000Z"), fromClient: true });
  });

  it("requires clientCreatedAt on a deferred sale", () => {
    expect(resolveSaleTime({ deferred: true }, NOW)).toEqual({ ok: false, code: "client_time_missing" });
  });

  it("tolerates small clock skew but clamps to now", () => {
    const ahead = new Date(NOW.getTime() + MAX_CLIENT_CLOCK_SKEW_MS - 1000).toISOString();
    expect(resolveSaleTime({ deferred: true, clientCreatedAt: ahead }, NOW)).toEqual({
      ok: true,
      saleAt: NOW,
      fromClient: true,
    });
  });

  it("rejects a sale from the future beyond the skew window", () => {
    const ahead = new Date(NOW.getTime() + MAX_CLIENT_CLOCK_SKEW_MS + 1000).toISOString();
    expect(resolveSaleTime({ deferred: true, clientCreatedAt: ahead }, NOW)).toEqual({
      ok: false,
      code: "client_time_in_future",
    });
  });

  it("rejects a sale older than the deferred window", () => {
    const old = new Date(NOW.getTime() - MAX_DEFERRED_SALE_AGE_MS - 1000).toISOString();
    expect(resolveSaleTime({ deferred: true, clientCreatedAt: old }, NOW)).toEqual({
      ok: false,
      code: "client_time_too_old",
    });
  });

  it("buckets a sale rung up just before IST midnight into that day, even when it syncs after", () => {
    // 23:59 IST on 6 Oct = 18:29 UTC; synced at 00:10 IST on 7 Oct.
    const syncedAt = new Date("2026-10-06T18:40:00.000Z");
    const r = resolveSaleTime({ deferred: true, clientCreatedAt: "2026-10-06T18:29:00.000Z" }, syncedAt);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(getIstTodayStart(r.saleAt).toISOString()).toBe("2026-10-06T00:00:00.000Z");
    expect(formatBillDateYYYYMMDD(r.saleAt)).toBe("20261006");
    expect(getIstTodayStart(syncedAt).toISOString()).toBe("2026-10-07T00:00:00.000Z");
  });
});

describe("transactionPostBodySchema offline fields", () => {
  const base = {
    items: [{ name: "Chai", priceInPaise: 1000, qty: 1 }],
    subtotalPaise: 1000,
    taxPaise: 0,
    totalPaise: 1000,
    paymentMethod: "CASH",
  };

  it("accepts a uuid clientRef and an ISO clientCreatedAt", () => {
    const r = transactionPostBodySchema.safeParse({
      ...base,
      clientRef: "3b241101-e2bb-4255-8caf-4136c566a962",
      clientCreatedAt: "2026-10-06T18:29:00.000Z",
      vendorId: "v1",
      deferred: true,
    });
    expect(r.success).toBe(true);
  });

  it("rejects a non-uuid clientRef", () => {
    expect(transactionPostBodySchema.safeParse({ ...base, clientRef: "abc" }).success).toBe(false);
  });

  it("still accepts the old body shape", () => {
    expect(transactionPostBodySchema.safeParse(base).success).toBe(true);
  });
});
