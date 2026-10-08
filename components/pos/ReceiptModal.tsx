"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PaymentMethod } from "@prisma/client";

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
import { useReceiptText, WhatsAppReceiptButton } from "@/components/receipts/WhatsAppReceipt";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatINR } from "@/lib/currency";
import { useCartStore } from "@/lib/cartStore";
import { receiptWhatsappUrl } from "@/lib/whatsapp-message";

export type ReceiptModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isDesktop: boolean;
  billNumber: string;
  totalPaise: number;
  paymentMethod: PaymentMethod;
  /** Set when the sale is saved on this device and hasn't synced yet. */
  queued: { localNo: number; needsSignIn: boolean } | null;
  onCloseAll: () => void;
};

export function ReceiptModal({
  open,
  onOpenChange,
  isDesktop,
  billNumber,
  totalPaise,
  paymentMethod,
  queued,
  onCloseAll,
}: ReceiptModalProps) {
  const router = useRouter();
  const clearCart = useCartStore((s) => s.clearCart);
  const [phone, setPhone] = useState("");
  // A queued sale has no bill on the server yet, so there is no receipt to send.
  const receiptText = useReceiptText(open && !queued, { billNumber });
  const waUrl = receiptText ? receiptWhatsappUrl(receiptText, phone) : null;
  const phoneInvalid = Boolean(receiptText) && !waUrl;

  useEffect(() => {
    if (!open) setPhone("");
  }, [open]);

  function newOrder() {
    clearCart();
    onCloseAll();
    onOpenChange(false);
    // Refetches today's revenue; offline that request can only fail.
    if (navigator.onLine) router.refresh();
  }

  const body = queued ? (
    <div className="space-y-4">
      <div className="rounded-lg bg-muted/50 px-4 py-3">
        <p className="text-xs text-muted-foreground">Saved on this phone</p>
        <p className="font-mono text-lg font-semibold tabular-nums text-foreground">Offline #{queued.localNo}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Paid {formatINR(totalPaise)} via {paymentMethod}
        </p>
      </div>
      <p className="text-sm text-muted-foreground" role="status">
        {queued.needsSignIn
          ? "Sign in again to sync it. It gets a bill number and receipt once it syncs."
          : "No connection right now. It syncs by itself and gets a bill number when you're back online."}
      </p>
      <Button type="button" className="h-12 w-full" onClick={newOrder}>
        New order 🆕
      </Button>
    </div>
  ) : (
    <div className="space-y-4">
      <div className="rounded-lg bg-muted/50 px-4 py-3">
        <p className="text-xs text-muted-foreground">Bill number</p>
        <p className="font-mono text-lg font-semibold tabular-nums text-foreground">{billNumber}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Paid {formatINR(totalPaise)} via {paymentMethod}
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="cust-phone">Customer mobile (+91, optional)</Label>
        <Input
          id="cust-phone"
          name="customerPhone"
          type="tel"
          inputMode="tel"
          autoComplete="off"
          placeholder="9876543210"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          aria-invalid={phoneInvalid}
          aria-describedby="cust-phone-hint"
          className="font-mono"
        />
        <p id="cust-phone-hint" className="text-xs text-muted-foreground" aria-live="polite">
          {receiptText === null
            ? "Couldn't load the receipt. Close and reopen to try again."
            : phoneInvalid
            ? "Enter a 10-digit mobile number, or leave blank to pick the chat in WhatsApp."
            : "Opens your WhatsApp with the receipt ready — tap send."}
        </p>
      </div>
      <WhatsAppReceiptButton url={waUrl} loading={receiptText === undefined} />
      <Button type="button" className="h-12 w-full" onClick={newOrder}>
        New order 🆕
      </Button>
    </div>
  );

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{queued ? "Paid · saved offline" : "Paid"}</DialogTitle>
            <DialogDescription>
              {queued ? "This sale syncs when you're back online." : "Share the receipt or start a new order."}
            </DialogDescription>
          </DialogHeader>
          {body}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto rounded-t-xl">
        <SheetHeader>
          <SheetTitle>{queued ? "Paid · saved offline" : "Paid"}</SheetTitle>
          <SheetDescription>
            {queued ? "This sale syncs when you're back online." : "Share the receipt or start a new order."}
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4">{body}</div>
      </SheetContent>
    </Sheet>
  );
}
