"use client";

import { useState } from "react";
import type { PaymentMethod, PaymentStatus, Plan } from "@prisma/client";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatINR } from "@/lib/currency";
import { PLAN_LIMITS } from "@/lib/constants";

export type TransactionDetailModel = {
  id: string;
  billNumber: string;
  createdAt: string;
  subtotalPaise: number;
  discountPaise: number;
  taxPaise: number;
  totalPaise: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  customerPhone: string | null;
  customerName: string | null;
  voiceTranscript: string | null;
  upiRef: string | null;
  orderItems: {
    id: string;
    name: string;
    qty: number;
    priceInPaise: number;
    totalPaise: number;
  }[];
  receipt: {
    receiptNumber: string;
    whatsappSent: boolean;
  } | null;
};

function formatIstDateTime(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: TransactionDetailModel | null;
  vendorName: string;
  vendorPlan: Plan;
  whatsappConfigured: boolean;
};

export function TransactionDetailDrawer({
  open,
  onOpenChange,
  transaction,
  vendorName,
  vendorPlan,
  whatsappConfigured,
}: Props) {
  const [sending, setSending] = useState(false);

  const canWhatsapp =
    PLAN_LIMITS[vendorPlan].whatsapp && whatsappConfigured && Boolean(transaction?.customerPhone?.trim());

  async function resendWhatsapp() {
    if (!transaction) return;
    setSending(true);
    try {
      const res = await fetch("/api/receipts/send", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionId: transaction.id }),
      });
      const data = (await res.json()) as { queued?: boolean; error?: string; code?: string };
      if (!res.ok) {
        throw new Error(data.error ?? "Could not queue receipt");
      }
      toast.success("Receipt queued for WhatsApp");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to queue");
    } finally {
      setSending(false);
    }
  }

  if (!transaction) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{transaction.billNumber}</SheetTitle>
          <SheetDescription>
            {vendorName} · {formatIstDateTime(transaction.createdAt)} IST
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{transaction.paymentMethod}</Badge>
            <Badge
              variant={
                transaction.paymentStatus === "PAID"
                  ? "default"
                  : transaction.paymentStatus === "PENDING"
                    ? "outline"
                    : "destructive"
              }
            >
              {transaction.paymentStatus}
            </Badge>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Line</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transaction.orderItems.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.qty}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatINR(row.priceInPaise)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatINR(row.totalPaise)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <dl className="space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd className="tabular-nums">{formatINR(transaction.subtotalPaise)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Discount</dt>
              <dd className="tabular-nums">{formatINR(transaction.discountPaise)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Tax</dt>
              <dd className="tabular-nums">{formatINR(transaction.taxPaise)}</dd>
            </div>
            <div className="flex justify-between font-semibold">
              <dt>Total</dt>
              <dd className="tabular-nums">{formatINR(transaction.totalPaise)}</dd>
            </div>
          </dl>

          {(transaction.customerName || transaction.customerPhone) && (
            <div className="rounded-md border p-3 text-sm">
              <p className="font-medium text-foreground">Customer</p>
              {transaction.customerName ? <p>{transaction.customerName}</p> : null}
              {transaction.customerPhone ? <p className="font-mono">{transaction.customerPhone}</p> : null}
            </div>
          )}

          {transaction.upiRef ? (
            <p className="font-mono text-xs text-muted-foreground">UPI ref: {transaction.upiRef}</p>
          ) : null}

          {transaction.voiceTranscript ? (
            <div className="rounded-md bg-muted/50 p-3 text-sm">
              <p className="font-medium text-foreground">Voice</p>
              <p className="text-muted-foreground">{transaction.voiceTranscript}</p>
            </div>
          ) : null}

          {transaction.receipt ? (
            <p className="text-xs text-muted-foreground">
              Receipt {transaction.receipt.receiptNumber}
              {transaction.receipt.whatsappSent ? " · Sent on WhatsApp" : ""}
            </p>
          ) : null}

          <Button
            type="button"
            className="w-full"
            disabled={!canWhatsapp || sending}
            title={
              !PLAN_LIMITS[vendorPlan].whatsapp
                ? "Upgrade to Starter for WhatsApp receipts"
                : !whatsappConfigured
                  ? "Configure WhatsApp number in settings"
                  : !transaction.customerPhone?.trim()
                    ? "No customer phone on this bill"
                    : undefined
            }
            onClick={() => void resendWhatsapp()}
          >
            {sending ? "Queueing…" : "Resend WhatsApp receipt"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
