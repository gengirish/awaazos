"use client";

import Link from "next/link";
import { CloudOff, RefreshCw, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatINR } from "@/lib/currency";
import { formatIstDateTime } from "@/lib/datetime";
import type { OutboxSale } from "@/lib/pos-outbox";

export type PosSyncStatusProps = {
  online: boolean;
  /** When the server rendered this page: the menu and prices are as of then. */
  renderedAt: string;
  pending: OutboxSale[];
  failed: OutboxSale[];
  needsSignIn: boolean;
  onSync: () => void;
  onDiscard: (clientRef: string) => void;
};

const FAIL_REASONS: Record<string, string> = {
  client_time_too_old: "older than 7 days",
  client_time_in_future: "phone clock was wrong",
  subtotal_mismatch: "totals didn't add up",
  total_mismatch: "totals didn't add up",
};

/**
 * Offline / outbox status above the POS. States are spelled out in text with an
 * icon, never colour alone, and announced politely.
 */
export function PosSyncStatus({
  online,
  renderedAt,
  pending,
  failed,
  needsSignIn,
  onSync,
  onDiscard,
}: PosSyncStatusProps) {
  // `sale` outlives `open` so the sheet's text holds still while it closes.
  const [confirmDiscard, setConfirmDiscard] = useState<{ open: boolean; sale: OutboxSale | null }>({
    open: false,
    sale: null,
  });

  if (online && pending.length === 0 && failed.length === 0) {
    return <div aria-live="polite" className="sr-only" />;
  }

  const n = pending.length;
  const salesWord = n === 1 ? "sale" : "sales";

  return (
    <div aria-live="polite" className="mt-4 space-y-2">
      {!online ? (
        <div className="flex items-start gap-2 rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground">
          <CloudOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>
            <span className="font-semibold">Offline.</span> Sales are saved on this phone and sync when you&apos;re
            back online. Menu as of {formatIstDateTime(renderedAt)}.
          </p>
        </div>
      ) : null}

      {n > 0 ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm">
          <p>
            {needsSignIn ? (
              <>
                <span className="font-semibold">
                  {n} {salesWord} waiting.
                </span>{" "}
                Sign in again to sync.
              </>
            ) : (
              <>
                <span className="font-semibold">
                  {n} {salesWord} waiting to sync
                </span>
                {online ? null : " (offline)"}
              </>
            )}
          </p>
          {needsSignIn ? (
            <Link
              href="/sign-in?callbackUrl=%2Fpos"
              className="inline-flex min-h-11 shrink-0 items-center rounded-md border border-input px-3 font-medium hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            >
              Sign in
            </Link>
          ) : online ? (
            <Button type="button" variant="outline" className="h-11 shrink-0" onClick={onSync}>
              <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden />
              Sync now
            </Button>
          ) : null}
        </div>
      ) : null}

      {failed.length > 0 ? (
        <details className="rounded-md border border-destructive/40 bg-background px-3 py-2 text-sm">
          <summary className="flex min-h-11 cursor-pointer items-center gap-2 font-semibold">
            <TriangleAlert className="h-4 w-4 shrink-0 text-destructive" aria-hidden />
            {failed.length} {failed.length === 1 ? "sale" : "sales"} couldn&apos;t sync. Write them down, then remove.
          </summary>
          <ul className="mt-2 space-y-2">
            {failed.map((s) => (
              <li key={s.clientRef} className="flex items-center justify-between gap-2">
                <span>
                  <span className="font-mono">Offline #{s.localNo}</span> · {formatINR(s.body.totalPaise)} ·{" "}
                  {s.body.paymentMethod} · {formatIstDateTime(s.clientCreatedAt)}
                  <span className="block text-xs text-muted-foreground">
                    {FAIL_REASONS[s.failCode ?? ""] ?? "rejected by the server"}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-11 shrink-0"
                  onClick={() => setConfirmDiscard({ open: true, sale: s })}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <ConfirmDialog
        open={confirmDiscard.open}
        onOpenChange={(open) => setConfirmDiscard((c) => ({ ...c, open }))}
        title={confirmDiscard.sale ? `Remove Offline #${confirmDiscard.sale.localNo} from this phone?` : ""}
        description={
          confirmDiscard.sale
            ? `This ${formatINR(confirmDiscard.sale.body.totalPaise)} sale never reached the server, and removing it can't be undone.`
            : ""
        }
        confirmLabel="Remove"
        onConfirm={() => {
          if (confirmDiscard.sale) onDiscard(confirmDiscard.sale.clientRef);
        }}
      />
    </div>
  );
}
