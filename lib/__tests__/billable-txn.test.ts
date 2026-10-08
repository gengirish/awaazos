import { describe, expect, it, vi } from "vitest";

// Keep Prisma/env/KV out of the unit run (same as drops.test.ts).
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/drops-signal", () => ({ bumpDropOrderSignal: vi.fn() }));

import {
  billableTxnSql,
  billableTxnWhere,
  countBillableTxnThisMonth,
  istMonthStartInstant,
} from "@/lib/drops";

describe("billableTxnWhere", () => {
  it("is counter sales of any status, plus storefront orders only when paid", () => {
    expect(billableTxnWhere()).toEqual({
      OR: [{ source: { not: "STOREFRONT" } }, { paymentStatus: "PAID" }],
    });
  });

  it("returns a fresh object each call (safe to spread / mutate)", () => {
    expect(billableTxnWhere()).not.toBe(billableTxnWhere());
  });

  it("has a raw-SQL twin with the same predicate", () => {
    expect(billableTxnSql.sql).toBe(`(t."source" <> 'STOREFRONT' OR t."paymentStatus" = 'PAID')`);
    expect(billableTxnSql.values).toEqual([]);
  });
});

describe("countBillableTxnThisMonth", () => {
  it("counts this vendor's billable rows since the IST month start", async () => {
    const count = vi.fn().mockResolvedValue(7);
    const db = { transaction: { count } } as unknown as Parameters<typeof countBillableTxnThisMonth>[0];
    const now = new Date("2026-10-31T20:00:00.000Z"); // 01/11/2026 01:30 IST

    await expect(countBillableTxnThisMonth(db, "vendor_1", now)).resolves.toBe(7);
    expect(count).toHaveBeenCalledTimes(1);
    expect(count).toHaveBeenCalledWith({
      where: {
        vendorId: "vendor_1",
        createdAt: { gte: new Date("2026-10-31T18:30:00.000Z") }, // 01/11/2026 00:00 IST
        ...billableTxnWhere(),
      },
    });
  });
});

describe("istMonthStartInstant", () => {
  it("is 00:00 IST on the 1st, not the 05:30 IST @db.Date key", () => {
    expect(istMonthStartInstant(new Date("2026-10-31T18:29:59.999Z")).toISOString()).toBe(
      "2026-09-30T18:30:00.000Z",
    );
    expect(istMonthStartInstant(new Date("2026-10-31T18:30:00.000Z")).toISOString()).toBe(
      "2026-10-31T18:30:00.000Z",
    );
    expect(istMonthStartInstant(new Date("2026-10-08T06:00:00.000Z")).toISOString()).toBe(
      "2026-09-30T18:30:00.000Z",
    );
  });
});
