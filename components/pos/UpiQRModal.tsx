"use client";

import { useEffect, useState } from "react";
import { PaymentMethod } from "@prisma/client";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatINR, paiseToRupees } from "@/lib/currency";
import { useQrDataUrl } from "@/hooks/useQrDataUrl";
import { checkoutSale } from "@/lib/pos-outbox";
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
  isDesktop: boolean;
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
  isDesktop,
  stallName,
  upiId,
  upiName,
  totalPaise,
  subtotalPaise,
  taxPaise,
  items,
  onPaid,
}: UpiQRModalProps) {
  const [payMode, setPayMode] = useState<"UPI" | "CASH">("UPI");
  const [upiRef, setUpiRef] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setPayMode("UPI");
      setUpiRef("");
      setSubmitting(false);
    }
  }, [open]);

  const effectiveUpiId = upiId?.trim() || "";
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
      const paymentMethod = payMode === "CASH" ? PaymentMethod.CASH : PaymentMethod.UPI;
      // Saved on the device first, then committed; offline it stays queued and
      // syncs later (lib/pos-outbox.ts). Either way the sale is not lost.
      const result = await checkoutSale(vendorId, {
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
      });
      if (result.kind === "rejected") {
        throw new Error(result.code === "monthly_txn_cap_reached" ? "Monthly bill limit reached for your plan" : result.code);
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
      console.error(e instanceof Error ? e.message : "checkout_failed");
      toast.error(e instanceof Error ? e.message : "Could not record payment");
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
          className="h-11 flex-1"
          onClick={() => setPayMode("UPI")}
        >
          UPI QR
        </Button>
        <Button
          type="button"
          variant={payMode === "CASH" ? "default" : "ghost"}
          className="h-11 flex-1"
          onClick={() => setPayMode("CASH")}
        >
          Cash
        </Button>
      </div>

      {payMode === "UPI" ? (
        <>
          {!effectiveUpiId ? (
            <p className="text-center text-sm text-destructive">Add a UPI ID in Settings → Payments to show a QR code.</p>
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
              <div className="space-y-2">
                <Label htmlFor="upi-ref">Customer&apos;s UPI Reference (UTR)</Label>
                <Input
                  id="upi-ref"
                  name="upiRef"
                  value={upiRef}
                  onChange={(e) => setUpiRef(e.target.value)}
                  autoComplete="off"
                  placeholder="Optional"
                  className="font-mono"
                />
              </div>
            </>
          )}
        </>
      ) : (
        <p className="text-center text-sm text-muted-foreground">Confirm once you have taken cash from the customer.</p>
      )}

      <Button
        type="button"
        className="h-12 w-full"
        disabled={submitting || (payMode === "UPI" && !effectiveUpiId)}
        onClick={() => void markPaid()}
      >
        Mark as paid ✓
      </Button>
    </div>
  );

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Collect payment</DialogTitle>
            <DialogDescription>Show the QR code or record cash received.</DialogDescription>
          </DialogHeader>
          {body}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto rounded-t-xl">
        <SheetHeader>
          <SheetTitle>Collect payment</SheetTitle>
          <SheetDescription>Show the QR code or record cash received.</SheetDescription>
        </SheetHeader>
        <div className="mt-4">{body}</div>
      </SheetContent>
    </Sheet>
  );
}
