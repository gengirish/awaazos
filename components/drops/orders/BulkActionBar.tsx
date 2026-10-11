"use client";

import { Bike, CheckCircle2, IndianRupee, Loader2, X } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatINR } from "@/lib/currency";
import type { BoardOrder } from "@/lib/drops-board";
import { bulkNeedsConfirm, cashToCollectPaise, type BulkOrderAction } from "@/lib/order-bulk";

type Props = {
  selectedCount: number;
  counts: Record<BulkOrderAction, number>;
  pending: BulkOrderAction | null;
  /** Selected orders the action would change (others are skipped). */
  targetsFor: (action: BulkOrderAction) => BoardOrder[];
  onRun: (action: BulkOrderAction) => void;
  onClear: () => void;
};

const LABEL: Record<BulkOrderAction, string> = {
  confirm: "Confirm",
  mark_paid: "Mark paid",
  deliver: "Delivered",
};

const ICON: Record<BulkOrderAction, ReactNode> = {
  confirm: <CheckCircle2 aria-hidden />,
  mark_paid: <IndianRupee aria-hidden />,
  deliver: <Bike aria-hidden />,
};

const ORDER: BulkOrderAction[] = ["confirm", "mark_paid", "deliver"];

function nOrders(n: number) {
  return n === 1 ? "1 order" : `${n} orders`;
}

/**
 * Sticky bar under the orders list while at least one order is selected.
 * Each button says how many of the selected orders it would change; orders
 * that can't take that action are skipped, not sent. Money-moving runs (mark
 * paid, delivering pay-on-delivery orders) ask first.
 */
export function BulkActionBar({ selectedCount, counts, pending, targetsFor, onRun, onClear }: Props) {
  const [confirming, setConfirming] = useState<BulkOrderAction | null>(null);
  const busy = pending !== null;
  const available = ORDER.filter((a) => counts[a] > 0);

  const start = (action: BulkOrderAction) => {
    if (bulkNeedsConfirm(action, targetsFor(action))) setConfirming(action);
    else onRun(action);
  };

  const dialogTargets = confirming ? targetsFor(confirming) : [];
  const totalPaise = dialogTargets.reduce((s, o) => s + o.totalPaise, 0);
  const cashPaise = cashToCollectPaise(dialogTargets);
  const cashCount = dialogTargets.filter((o) => o.paymentMethod === "CASH" && o.paymentStatus !== "PAID").length;

  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="sticky bottom-[var(--app-bottom-inset,0px)] z-10 -mx-4 mt-4 border-t bg-background px-4 py-3 shadow-lg"
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm font-semibold" aria-live="polite" aria-atomic="true">
          {nOrders(selectedCount)} selected
        </p>
        <Button
          type="button"
          variant="ghost"
          className="min-h-11"
          onClick={onClear}
          disabled={busy}
          aria-label="Clear selection"
        >
          <X aria-hidden />
          Clear
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {available.length === 0 ? (
          <p className="text-sm text-muted-foreground">No action fits all of these orders. Use the buttons on each order.</p>
        ) : (
          available.map((a) => (
            <Button
              key={a}
              type="button"
              variant={a === "confirm" ? "default" : a === "deliver" ? "secondary" : "outline"}
              className="min-h-11 flex-1 basis-[30%] text-sm"
              disabled={busy}
              aria-busy={pending === a}
              aria-label={
                counts[a] === selectedCount
                  ? `${LABEL[a]} ${nOrders(counts[a])}`
                  : `${LABEL[a]} ${counts[a]} of ${nOrders(selectedCount)}`
              }
              onClick={() => start(a)}
            >
              {pending === a ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : ICON[a]}
              {LABEL[a]} ({counts[a]})
            </Button>
          ))
        )}
      </div>

      <Dialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirming === "mark_paid"
                ? `Mark ${nOrders(dialogTargets.length)} paid?`
                : `Mark ${nOrders(dialogTargets.length)} delivered?`}
            </DialogTitle>
            <DialogDescription>
              {confirming === "mark_paid"
                ? `Adds ${formatINR(totalPaise)} to your sales. Only do this after you have seen the money in your UPI app.`
                : `${nOrders(cashCount)} ${cashCount === 1 ? "is" : "are"} pay on delivery. This records ${formatINR(cashPaise)} cash collected.`}
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-48 divide-y overflow-y-auto rounded-md border text-sm" aria-label="Orders to change">
            {dialogTargets.map((o) => (
              <li key={o.id} className="flex justify-between gap-2 px-3 py-2">
                <span className="min-w-0 truncate">
                  <span className="font-mono text-xs text-muted-foreground">{o.billNumber}</span>{" "}
                  {o.customerName?.trim() || "Customer"}
                </span>
                <span className="font-mono tabular-nums">{formatINR(o.totalPaise)}</span>
              </li>
            ))}
          </ul>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="min-h-11" onClick={() => setConfirming(null)}>
              Go back
            </Button>
            <Button
              type="button"
              className="min-h-11"
              onClick={() => {
                const a = confirming;
                setConfirming(null);
                if (a) onRun(a);
              }}
            >
              {confirming === "mark_paid" ? "Yes, mark paid" : "Yes, mark delivered"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
