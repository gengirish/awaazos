import { PaymentMethod } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  checkTransactionTotals,
  transactionPostBodySchema,
} from "@/lib/transaction-post-body";

const baseItem = { name: "Samosa", priceInPaise: 2000, qty: 2, menuItemId: "m1" };

describe("transaction-post-body", () => {
  it("detects subtotal_mismatch", () => {
    const r = checkTransactionTotals({
      items: [baseItem],
      subtotalPaise: 999,
      discountPaise: 0,
      taxPaise: 0,
      totalPaise: 999,
    });
    expect(r).toEqual({ ok: false, code: "subtotal_mismatch" });
  });

  it("detects total_mismatch", () => {
    const r = checkTransactionTotals({
      items: [baseItem],
      subtotalPaise: 4000,
      discountPaise: 0,
      taxPaise: 100,
      totalPaise: 9999,
    });
    expect(r).toEqual({ ok: false, code: "total_mismatch" });
  });

  it("rejects negative qty via zod", () => {
    const parsed = transactionPostBodySchema.safeParse({
      items: [{ name: "x", priceInPaise: 100, qty: -1 }],
      subtotalPaise: 0,
      taxPaise: 0,
      totalPaise: 0,
      paymentMethod: PaymentMethod.CASH,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects empty items", () => {
    const parsed = transactionPostBodySchema.safeParse({
      items: [],
      subtotalPaise: 0,
      taxPaise: 0,
      totalPaise: 0,
      paymentMethod: PaymentMethod.CASH,
    });
    expect(parsed.success).toBe(false);
  });
});
