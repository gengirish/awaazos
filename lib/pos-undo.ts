/**
 * Undo for a counter sale just marked paid (POS toast, 5 s). The sale is
 * committed at once, as before; Undo is a real revert through
 * `POST /api/transactions/undo`, which deletes the row (its items and receipt
 * cascade) and takes it back out of DailySummary in one Postgres transaction.
 * Every report reads those rows, so nothing else needs correcting.
 *
 * Pure rules here, client-safe; the route holds the database side.
 */

/** How long the POS offers Undo. A UI timer only: nothing polls. */
export const POS_UNDO_TOAST_MS = 5_000;

/**
 * How long after the commit the server still accepts an undo. Longer than the
 * toast so a slow phone network can't strand a tap made inside it; short
 * enough that Undo can't become a way to delete old bills.
 */
export const POS_UNDO_SERVER_WINDOW_MS = 2 * 60 * 1000;

/**
 * `committedAt` is the receipt row's `createdAt`: server time, written in the
 * same transaction as the sale. (`Transaction.createdAt` is the device's time
 * for a sale that synced late, so it can't bound the window.)
 */
export function withinUndoWindow(committedAt: Date, now: Date = new Date()): boolean {
  const age = now.getTime() - committedAt.getTime();
  return age >= -60_000 && age <= POS_UNDO_SERVER_WINDOW_MS;
}

/** `AWZ-20261107-0042` → { ymd: "20261107", seq: 42 }; anything else → null. */
export function parseBillNumber(billNumber: string): { ymd: string; seq: number } | null {
  const m = /^AWZ-(\d{8})-(\d{4,})$/.exec(billNumber);
  if (!m) return null;
  return { ymd: m[1]!, seq: Number(m[2]) };
}

/** The `@db.Date` key (UTC midnight of the IST day) a bill number was issued under. */
export function billDayFromYmd(ymd: string): Date {
  return new Date(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T00:00:00.000Z`);
}

/** What one counter sale added to its DailySummary row, to take back out. */
export function dailySummaryReversal(sale: {
  totalPaise: number;
  paymentMethod: string;
  itemQtys: number[];
}) {
  return {
    totalRevenuePaise: sale.totalPaise,
    totalTransactions: 1,
    totalItemsSold: sale.itemQtys.reduce((s, q) => s + q, 0),
    cashRevenuePaise: sale.paymentMethod === "CASH" ? sale.totalPaise : 0,
    upiRevenuePaise: sale.paymentMethod === "UPI" ? sale.totalPaise : 0,
  };
}
