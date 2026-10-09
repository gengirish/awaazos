"use client";

import type { PaymentMethod, PaymentStatus } from "@prisma/client";

import { PrintReceiptLink, useReceiptText, WhatsAppReceiptButton } from "@/components/receipts/WhatsAppReceipt";
import { Badge } from "@/components/ui/badge";
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
import { formatIstDateTime } from "@/lib/datetime";
import { receiptWhatsappUrl } from "@/lib/whatsapp-message";

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

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: TransactionDetailModel | null;
  vendorName: string;
};

export function TransactionDetailDrawer({ open, onOpenChange, transaction, vendorName }: Props) {
  const receiptText = useReceiptText(open, { transactionId: transaction?.id });
  // A bad stored number shouldn't block the resend — fall back to WhatsApp's chat picker.
  const waUrl = receiptText
    ? (receiptWhatsappUrl(receiptText, transaction?.customerPhone) ?? receiptWhatsappUrl(receiptText))
    : null;

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

          <WhatsAppReceiptButton
            url={waUrl}
            loading={receiptText === undefined}
            label={transaction.customerPhone?.trim() ? "Resend on WhatsApp" : "Send on WhatsApp"}
            className="h-11 w-full"
          />
          <PrintReceiptLink billNumber={transaction.billNumber} className="h-11 w-full" />
          {receiptText === null ? (
            <p className="text-xs text-muted-foreground" role="status">
              Couldn&apos;t load the receipt. Close and reopen to try again.
            </p>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
