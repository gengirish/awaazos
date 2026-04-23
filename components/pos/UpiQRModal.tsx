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
import { buildQrUrl, buildUpiDeepLink } from "@/lib/upi";
import type { CartLine } from "@/lib/cartStore";

export type UpiQRModalProps = {
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
  onPaid: (result: {
    billNumber: string;
    totalPaise: number;
    paymentMethod: PaymentMethod;
  }) => void;
};

export function UpiQRModal({
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
  const qrSrc = upiLink ? buildQrUrl(upiLink, 256) : "";

  async function markPaid() {
    setSubmitting(true);
    try {
      const res = await fetch("/api/transactions", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: items.map((i) => ({
            menuItemId: i.menuItemId,
            name: i.name,
            priceInPaise: i.priceInPaise,
            qty: i.qty,
          })),
          subtotalPaise,
          taxPaise,
          totalPaise,
          paymentMethod: payMode === "CASH" ? PaymentMethod.CASH : PaymentMethod.UPI,
          upiRef: payMode === "UPI" ? (upiRef.trim() || null) : null,
        }),
      });
      const data = (await res.json()) as {
        transaction?: { billNumber: string; totalPaise: number; paymentMethod: PaymentMethod };
        error?: string;
      };
      if (!res.ok || !data.transaction) {
        throw new Error(data.error ?? "Payment failed");
      }
      onPaid({
        billNumber: data.transaction.billNumber,
        totalPaise: data.transaction.totalPaise,
        paymentMethod: data.transaction.paymentMethod,
      });
      onOpenChange(false);
    } catch (e) {
      console.error(e);
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
            <p className="text-center text-sm text-destructive">Add a UPI ID in vendor settings to show a QR code.</p>
          ) : (
            <>
              <div className="flex flex-col items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- external QR API URL */}
                <img
                  src={qrSrc}
                  alt="UPI payment QR code"
                  width={256}
                  height={256}
                  className="rounded-md border bg-white p-2"
                />
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
