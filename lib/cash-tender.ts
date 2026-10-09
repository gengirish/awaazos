/**
 * Counter-side cash helpers for the POS payment sheet. Informational only:
 * nothing here is sent to the server. All amounts are integer paise.
 */
import type { PaymentMethod } from "@prisma/client";

import { rupeesToPaise } from "@/lib/currency";

/** Notes a customer is likely to hand over, in paise. */
const TENDER_NOTES_PAISE = [5_000, 10_000, 20_000, 50_000, 200_000] as const;

/** Most quick-tender buttons shown next to "Exact". */
export const MAX_QUICK_TENDERS = 5;

/**
 * Likely amounts handed over for `totalPaise`: for each common note, the
 * smallest multiple of it above the total. Strictly greater than the total
 * ("Exact" covers equal), deduped, ascending, capped at MAX_QUICK_TENDERS.
 */
export function quickTenderPaise(totalPaise: number): number[] {
  if (!Number.isInteger(totalPaise) || totalPaise <= 0) return [];
  const out = new Set<number>();
  for (const note of TENDER_NOTES_PAISE) {
    const rem = totalPaise % note;
    // Already a whole number of this note: "Exact" covers it.
    if (rem === 0) continue;
    out.add(totalPaise - rem + note);
  }
  return Array.from(out).sort((a, b) => a - b).slice(0, MAX_QUICK_TENDERS);
}

/**
 * Parses what the vendor typed into "Received" (rupees) into paise.
 * Empty, malformed or more than 2 decimals → null.
 */
export function parseRupeesInput(raw: string): number | null {
  const s = raw.trim().replace(/,/g, "");
  if (!/^\d{1,9}(\.\d{0,2})?$/.test(s)) return null;
  try {
    return rupeesToPaise(Number(s));
  } catch {
    return null;
  }
}

/** Paise → the plain rupee string the "Received" input holds ("40", "40.5"). */
export function paiseToRupeesInput(paise: number): string {
  const frac = paise % 100;
  const whole = (paise - frac) / 100;
  if (frac === 0) return String(whole);
  return `${whole}.${String(frac).padStart(2, "0")}`;
}

export type CashChange =
  | { kind: "change"; changePaise: number }
  | { kind: "short"; shortPaise: number };

/** Change owed (≥ 0) or how much is still short. */
export function cashChange(totalPaise: number, receivedPaise: number): CashChange {
  const diff = receivedPaise - totalPaise;
  return diff >= 0 ? { kind: "change", changePaise: diff } : { kind: "short", shortPaise: -diff };
}

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: "Cash",
  UPI: "UPI",
  CARD: "Card",
  RAZORPAY_LINK: "Razorpay link",
};

/** Human label for a PaymentMethod enum value ("CASH" → "Cash"). */
export function paymentMethodLabel(method: PaymentMethod | string): string {
  return PAYMENT_METHOD_LABELS[method as PaymentMethod] ?? String(method);
}
