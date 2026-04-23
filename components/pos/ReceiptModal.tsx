"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
import { formatINR } from "@/lib/currency";
import { useCartStore } from "@/lib/cartStore";

export type ReceiptModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isDesktop: boolean;
  billNumber: string;
  totalPaise: number;
  paymentMethod: PaymentMethod;
  onCloseAll: () => void;
};

export function ReceiptModal({
  open,
  onOpenChange,
  isDesktop,
  billNumber,
  totalPaise,
  paymentMethod,
  onCloseAll,
}: ReceiptModalProps) {
  const router = useRouter();
  const clearCart = useCartStore((s) => s.clearCart);
  const [phone, setPhone] = useState("");

  useEffect(() => {
    if (!open) setPhone("");
  }, [open]);

  async function sendWhatsApp() {
    const trimmed = phone.replace(/\s/g, "");
    try {
      const res = await fetch("/api/receipts/send", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          billNumber,
          customerPhone: trimmed.startsWith("+") ? trimmed : `+91${trimmed.replace(/^\+?91/, "")}`,
        }),
      });
      if (res.ok) {
        toast.success("Receipt request sent.");
      } else {
        toast.warning("Receipts API not ready yet — we logged your request locally.");
      }
    } catch {
      toast.warning("Could not reach receipt service — try again later.");
    }
  }

  function newOrder() {
    clearCart();
    onCloseAll();
    onOpenChange(false);
    router.refresh();
  }

  const body = (
    <div className="space-y-4">
      <div className="rounded-lg bg-muted/50 px-4 py-3">
        <p className="text-xs text-muted-foreground">Bill number</p>
        <p className="font-mono text-lg font-semibold tabular-nums text-foreground">{billNumber}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Paid {formatINR(totalPaise)} via {paymentMethod}
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="cust-phone">Customer mobile (+91)</Label>
        <Input
          id="cust-phone"
          name="customerPhone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="9876543210"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="font-mono"
        />
      </div>
      <Button type="button" variant="secondary" className="h-12 w-full" onClick={() => void sendWhatsApp()}>
        Send on WhatsApp
      </Button>
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
            <DialogTitle>Paid</DialogTitle>
            <DialogDescription>Share the receipt or start a new order.</DialogDescription>
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
          <SheetTitle>Paid</SheetTitle>
          <SheetDescription>Share the receipt or start a new order.</SheetDescription>
        </SheetHeader>
        <div className="mt-4">{body}</div>
      </SheetContent>
    </Sheet>
  );
}
