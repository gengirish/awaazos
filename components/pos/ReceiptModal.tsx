"use client";

import { useEffect, useRef, useState } from "react";
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
import {
  PrintReceiptLink,
  useAutoPrintReceipt,
  useReceiptText,
  WhatsAppReceiptButton,
} from "@/components/receipts/WhatsAppReceipt";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { paymentMethodLabel } from "@/lib/cash-tender";
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
  /** VendorSettings.autoPrintReceipt — counter computers only (see useAutoPrintReceipt). */
  autoPrint: boolean;
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
  autoPrint,
  onCloseAll,
}: ReceiptModalProps) {
  const router = useRouter();
  const clearCart = useCartStore((s) => s.clearCart);
  const [phone, setPhone] = useState("");
  // A queued sale has no bill on the server yet, so there is no receipt to send.
  const receiptText = useReceiptText(open && !queued, { billNumber });
  const waUrl = receiptText ? receiptWhatsappUrl(receiptText, phone) : null;
  const phoneInvalid = Boolean(receiptText) && !waUrl;
  // Phones print through the share sheet / a printer app, so only a desktop
  // counter gets the dialog without a tap.
  useAutoPrintReceipt(open && !queued && autoPrint && isDesktop && billNumber ? billNumber : null);

  const newOrderRef = useRef<HTMLButtonElement>(null);
  const waWrapRef = useRef<HTMLDivElement>(null);
  const methodLabel = paymentMethodLabel(paymentMethod);

  useEffect(() => {
    if (!open) setPhone("");
  }, [open]);

  // The receipt text arrives after the sheet opens. When it does, move focus
  // from "New order" to the WhatsApp link, unless the vendor has already moved
  // focus elsewhere (e.g. into the phone field).
  const receiptReady = typeof receiptText === "string";
  useEffect(() => {
    if (!open || !receiptReady) return;
    const active = document.activeElement;
    if (active && active !== document.body && active !== newOrderRef.current) return;
    waWrapRef.current?.querySelector<HTMLElement>("a[href]")?.focus();
  }, [open, receiptReady]);

  function focusPrimary(e: Event) {
    const wa = waWrapRef.current?.querySelector<HTMLElement>("a[href]");
    const target = wa ?? newOrderRef.current;
    if (target) {
      e.preventDefault();
      target.focus();
    }
  }

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
          Paid {formatINR(totalPaise)} via {methodLabel}
        </p>
      </div>
      <p className="text-sm text-muted-foreground" role="status">
        {queued.needsSignIn
          ? "Sign in again to sync it. It gets a bill number and receipt once it syncs."
          : "No connection right now. It syncs by itself and gets a bill number when you're back online."}
      </p>
      <Button ref={newOrderRef} type="button" className="h-12 w-full" onClick={newOrder}>
        New order
      </Button>
    </div>
  ) : (
    <div className="space-y-4">
      <div className="rounded-lg bg-muted/50 px-4 py-3">
        <p className="text-xs text-muted-foreground">Bill number</p>
        <p className="font-mono text-lg font-semibold tabular-nums text-foreground">{billNumber}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Paid {formatINR(totalPaise)} via {methodLabel}
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
      <div ref={waWrapRef}>
        <WhatsAppReceiptButton url={waUrl} loading={receiptText === undefined} />
      </div>
      <PrintReceiptLink billNumber={billNumber} />
      <Button ref={newOrderRef} type="button" className="h-12 w-full" onClick={newOrder}>
        New order
      </Button>
    </div>
  );

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent onOpenAutoFocus={focusPrimary}>
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
      <SheetContent
        side="bottom"
        className="max-h-[90vh] overflow-y-auto rounded-t-xl"
        onOpenAutoFocus={focusPrimary}
      >
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
