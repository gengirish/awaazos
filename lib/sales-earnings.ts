/**
 * Sales interns' revenue share, for /admin/earnings. Pure. A report only: it
 * moves no money and records no payouts.
 *
 * The share is SALES_SHARE_BPS of what a store the intern built pays us,
 * excluding GST, for SALES_SHARE_MONTHS from that store's first charge.
 * Charges come from the `SubscriptionEvent` ledger, whose amounts include GST.
 * The ledger has no refunds, so a refund must be taken off by hand.
 */
import { GST_BPS } from "@/lib/constants";
import { formatIstDate } from "@/lib/datetime";

export const SALES_SHARE_BPS = 5000;
export const SALES_SHARE_MONTHS = 12;

export type SalesCharge = { paymentId: string | null; amountPaise: number; at: Date };

export type SalesShareLine = { at: Date; basePaise: number; sharePaise: number };

export type StoreEarnings = {
  firstChargeAt: Date;
  shareEndsAt: Date;
  /** Charges inside the share window, oldest first. */
  lines: SalesShareLine[];
};

export type MonthEarnings = { key: string; label: string; basePaise: number; sharePaise: number };

/** What we keep of a charge once GST is out: the inverse of `subscriptionChargePaise`. */
export function chargeBasePaise(amountPaise: number): number {
  return Math.floor((amountPaise * 10_000) / (10_000 + GST_BPS));
}

export function salesSharePaise(basePaise: number): number {
  return Math.floor((basePaise * SALES_SHARE_BPS) / 10_000);
}

export function shareEndsAt(firstChargeAt: Date): Date {
  const end = new Date(firstChargeAt);
  end.setUTCMonth(end.getUTCMonth() + SALES_SHARE_MONTHS);
  return end;
}

/** One store's charges → its share. Null if it has none. A payment counts once, however many events name it. */
export function storeEarnings(charges: readonly SalesCharge[]): StoreEarnings | null {
  const seen = new Set<string>();
  const unique = [...charges]
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .filter((c) => {
      if (c.amountPaise <= 0) return false;
      if (!c.paymentId) return true;
      if (seen.has(c.paymentId)) return false;
      seen.add(c.paymentId);
      return true;
    });
  const first = unique[0];
  if (!first) return null;
  const end = shareEndsAt(first.at);
  return {
    firstChargeAt: first.at,
    shareEndsAt: end,
    lines: unique
      .filter((c) => c.at.getTime() < end.getTime())
      .map((c) => {
        const basePaise = chargeBasePaise(c.amountPaise);
        return { at: c.at, basePaise, sharePaise: salesSharePaise(basePaise) };
      }),
  };
}

/** The IST calendar month of a charge, "2026-11". */
export function istMonthKey(at: Date): string {
  const [, month, year] = formatIstDate(at).split("/");
  return `${year}-${month}`;
}

const MONTH_LABEL = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

function monthLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return MONTH_LABEL.format(new Date(Date.UTC(year!, month! - 1, 1)));
}

/** Newest month first. */
export function earningsByMonth(lines: readonly SalesShareLine[]): MonthEarnings[] {
  const months = new Map<string, MonthEarnings>();
  for (const line of lines) {
    const key = istMonthKey(line.at);
    const month = months.get(key) ?? { key, label: monthLabel(key), basePaise: 0, sharePaise: 0 };
    month.basePaise += line.basePaise;
    month.sharePaise += line.sharePaise;
    months.set(key, month);
  }
  return [...months.values()].sort((a, b) => b.key.localeCompare(a.key));
}
