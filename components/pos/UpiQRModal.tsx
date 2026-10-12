"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import type { PaymentMethod } from "@prisma/client";
import { Check, ChevronDown } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { cashChange, paiseToRupeesInput, parseRupeesInput, quickTenderPaise } from "@/lib/cash-tender";
import { formatINR, formatINRCompact, paiseToRupees } from "@/lib/currency";
import { useQrDataUrl } from "@/hooks/useQrDataUrl";
import { checkoutSale, saleRejectedMessage, saleUnsavedMessage } from "@/lib/pos-outbox";
import { buildUpiDeepLink } from "@/lib/upi";
import type { CartLine } from "@/lib/cartStore";

/** A sale that committed now, or one saved on the device to sync later. */
export type PaidResult =
  | { kind: "synced"; billNumber: string; totalPaise: number; paymentMethod: PaymentMethod }
  | { kind: "queued"; localNo: number; totalPaise: number; paymentMethod: PaymentMethod; needsSignIn: boolean };

export type UpiQRModalProps = {
  vendorId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stallName: string;
  upiId: string | null;
  upiName: string | null;
  totalPaise: number;
  subtotalPaise: number;
  taxPaise: number;
  items: CartLine[];
  onPaid: (result: PaidResult) => void;
};

export function UpiQRModal({
  vendorId,
  open,
  onOpenChange,
  stallName,
  upiId,
  upiName,
  totalPaise,
  subtotalPaise,
  taxPaise,
  items,
  onPaid,
}: UpiQRModalProps) {
  const effectiveUpiId = upiId?.trim() || "";
  // No UPI ID means no QR to show, so cash is the mode that can actually be paid.
  const defaultMode: "UPI" | "CASH" = effectiveUpiId ? "UPI" : "CASH";

  const [payMode, setPayMode] = useState<"UPI" | "CASH">(defaultMode);
  const [upiRef, setUpiRef] = useState("");
  const [showUpiRef, setShowUpiRef] = useState(false);
  const [received, setReceived] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const markPaidRef = useRef<HTMLButtonElement>(null);
  // clientRef of a sale that could be neither committed nor saved on the
  // device. Reused while this sheet stays open, so a second tap replays the
  // same sale and can't bill twice if the first post did land.
  const unsavedRef = useRef<string | null>(null);
  const ids = useId();
  const upiRefFieldId = `${ids}-upi-ref-field`;
  const receivedHintId = `${ids}-received-hint`;

  useEffect(() => {
    if (!open) {
      setPayMode(defaultMode);
      setUpiRef("");
      setShowUpiRef(false);
      setReceived("");
      setSubmitting(false);
      unsavedRef.current = null;
    }
  }, [open, defaultMode]);

  // Change calculator is informational only: never sent to the server and it
  // never blocks "Mark as paid".
  const receivedPaise = parseRupeesInput(received);
  const change = receivedPaise === null ? null : cashChange(totalPaise, receivedPaise);
  const tenders = quickTenderPaise(totalPaise);

  function focusPrimary(e: Event) {
    // Radix would focus the first focusable (the mode toggle); land on the
    // action the vendor most likely wants instead.
    if (markPaidRef.current && !markPaidRef.current.disabled) {
      e.preventDefault();
      markPaidRef.current.focus({ preventScroll: true });
    }
  }

  const effectiveName = (upiName?.trim() || stallName || "Merchant").slice(0, 80);
  const billRef = stallName.slice(0, 40) || "AwaazOS";

  const upiLink =
    payMode === "UPI" && effectiveUpiId
      ? buildUpiDeepLink({
          upiId: effectiveUpiId,
          name: effectiveName,
          amountRupees: paiseToRupees(totalPaise),
          billRef,
        })
      : "";
  // Rendered on the device, so the QR works offline and the VPA/amount never
  // go to a third-party image service.
  const qrSrc = useQrDataUrl(upiLink, 256);

  async function markPaid() {
    setSubmitting(true);
    try {
      const paymentMethod: PaymentMethod = payMode === "CASH" ? "CASH" : "UPI";
      // Saved on the device first, then committed; offline it stays queued and
      // syncs later (lib/pos-outbox.ts). Either way the sale is not lost.
      const result = await checkoutSale(
        vendorId,
        {
          items: items.map((i) => ({
            menuItemId: i.menuItemId,
            name: i.name,
            priceInPaise: i.priceInPaise,
            qty: i.qty,
          })),
          subtotalPaise,
          taxPaise,
          totalPaise,
          paymentMethod,
          upiRef: payMode === "UPI" ? (upiRef.trim() || null) : null,
        },
        { clientRef: unsavedRef.current ?? undefined },
      );
      if (result.kind === "rejected") {
        toast.error(saleRejectedMessage(result.code, result.status));
        return;
      }
      if (result.kind === "unsaved") {
        // Nothing holds this sale (device storage failed and the server did
        // not confirm it): keep the cart and this sheet, never show it as queued.
        unsavedRef.current = result.clientRef;
        toast.error(saleUnsavedMessage(result.reason));
        return;
      }
      onPaid(
        result.kind === "synced"
          ? {
              kind: "synced",
              billNumber: result.bill.billNumber,
              totalPaise: result.bill.totalPaise,
              paymentMethod: result.bill.paymentMethod,
            }
          : {
              kind: "queued",
              localNo: result.localNo,
              totalPaise,
              paymentMethod,
              needsSignIn: result.needsSignIn,
            },
      );
      onOpenChange(false);
    } catch (e) {
      // Never show (or log) a raw thrown message: only the error's class name.
      console.error("checkout_failed", e instanceof Error ? e.name : "unknown");
      toast.error("Could not record payment");
    } finally {
      setSubmitting(false);
    }
  }

  const body = (
    <div className="space-y-4">
      <div className="rounded-lg bg-muted/50 px-4 py-3 text-center">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Amount due</p>
        <p className="font-mono text-3xl font-bold tabular-nums text-foreground">{formatINR(totalPaise)}</p>
      </div>

      <div className="flex gap-2 rounded-lg border p-1">
        <Button
          type="button"
          variant={payMode === "UPI" ? "default" : "ghost"}
          aria-pressed={payMode === "UPI"}
          className="h-11 flex-1"
          onClick={() => setPayMode("UPI")}
        >
          UPI QR
        </Button>
        <Button
          type="button"
          variant={payMode === "CASH" ? "default" : "ghost"}
          aria-pressed={payMode === "CASH"}
          className="h-11 flex-1"
          onClick={() => setPayMode("CASH")}
        >
          Cash
        </Button>
      </div>

      {payMode === "UPI" ? (
        <>
          {!effectiveUpiId ? (
            <p className="text-center text-sm text-destructive">
              <Link
                href="/settings/payments"
                className="inline-flex min-h-11 items-center font-medium underline underline-offset-4"
              >
                Add a UPI ID
              </Link>{" "}
              to show a QR code.
            </p>
          ) : (
            <>
              <div className="flex flex-col items-center gap-2">
                {qrSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element -- local SVG data URL
                  <img
                    src={qrSrc}
                    alt="UPI payment QR code"
                    width={256}
                    height={256}
                    className="rounded-md border bg-white p-2"
                  />
                ) : (
                  <div className="h-[256px] w-[256px] rounded-md border bg-muted" aria-hidden />
                )}
                <p className="text-center text-xs text-muted-foreground">Scan with GPay / PhonePe / Paytm</p>
                <p className="break-all text-center font-mono text-sm text-foreground">{effectiveUpiId}</p>
              </div>
              {showUpiRef ? (
                <div className="space-y-2" id={upiRefFieldId}>
                  <Label htmlFor="upi-ref">Customer&apos;s UPI Reference (UTR)</Label>
                  <Input
                    id="upi-ref"
                    name="upiRef"
                    value={upiRef}
                    onChange={(e) => setUpiRef(e.target.value)}
                    autoComplete="off"
                    placeholder="Optional"
                    className="font-mono"
                    autoFocus
                  />
                </div>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  className="h-11 w-full text-muted-foreground"
                  aria-expanded={false}
                  onClick={() => setShowUpiRef(true)}
                >
                  <ChevronDown className="mr-1 h-4 w-4" aria-hidden />
                  Add UPI reference (optional)
                </Button>
              )}
            </>
          )}
        </>
      ) : (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="cash-received">Received (₹)</Label>
            <Input
              id="cash-received"
              name="received"
              inputMode="numeric"
              autoComplete="off"
              placeholder="Optional"
              value={received}
              onChange={(e) => setReceived(e.target.value)}
              aria-describedby={receivedHintId}
              className="h-12 font-mono text-lg tabular-nums"
            />
          </div>
          <div className="grid grid-cols-3 gap-2" role="group" aria-label="Amount received">
            <Button
              type="button"
              variant={receivedPaise === totalPaise ? "default" : "outline"}
              className="h-11"
              aria-pressed={receivedPaise === totalPaise}
              onClick={() => setReceived(paiseToRupeesInput(totalPaise))}
            >
              Exact
            </Button>
            {tenders.map((p) => (
              <Button
                key={p}
                type="button"
                variant={receivedPaise === p ? "default" : "outline"}
                className="h-11 font-mono tabular-nums"
                aria-pressed={receivedPaise === p}
                onClick={() => setReceived(paiseToRupeesInput(p))}
              >
                {formatINRCompact(p)}
              </Button>
            ))}
          </div>
          <div id={receivedHintId} aria-live="polite" className="min-h-12">
            {change === null ? (
              <p className="text-center text-sm text-muted-foreground">
                {received.trim() ? "Enter rupees, e.g. 100" : "Confirm once you have taken cash from the customer."}
              </p>
            ) : change.kind === "change" ? (
              <p className="rounded-lg border border-primary/40 bg-primary/10 px-4 py-2 text-center">
                <span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Change to return
                </span>
                <span className="font-mono text-2xl font-bold tabular-nums text-foreground">
                  {formatINR(change.changePaise)}
                </span>
              </p>
            ) : (
              <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2 text-center font-semibold text-destructive">
                {formatINR(change.shortPaise)} short
              </p>
            )}
          </div>
        </div>
      )}

      <Button
        ref={markPaidRef}
        type="button"
        className="h-12 w-full"
        disabled={submitting || (payMode === "UPI" && !effectiveUpiId)}
        onClick={() => void markPaid()}
      >
        Mark as paid
        <Check className="ml-1 h-5 w-5" aria-hidden />
      </Button>
    </div>
  );

  // Bottom sheet on phones, centred dialog from md up (CSS breakpoint).
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent onOpenAutoFocus={focusPrimary}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Collect payment</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>Show the QR code or record cash received.</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody>{body}</ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
