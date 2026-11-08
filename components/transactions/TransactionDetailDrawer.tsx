"use client";

import type { PaymentMethod, PaymentStatus } from "@prisma/client";

import { PrintReceiptLink, useReceiptText, WhatsAppReceiptButton } from "@/components/receipts/WhatsAppReceipt";
import { PaymentMethodBadge, PaymentStatusBadge } from "@/components/transactions/payment-badges";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { formatINR } from "@/lib/currency";
import { formatIstDateTime } from "@/lib/datetime";
import { discountLabel } from "@/lib/offers";
import { receiptWhatsappUrl } from "@/lib/whatsapp-message";

export type TransactionDetailModel = {
  id: string;
  billNumber: string;
  createdAt: string;
  subtotalPaise: number;
  discountPaise: number;
  offerName?: string | null;
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

/**
 * One bill's detail: a bottom sheet on phones, a centred dialog from md
 * (ResponsiveDialog). Items are a stacked list at every width — a four-column
 * table does not fit a 360px sheet.
 */
export function TransactionDetailDrawer({ open, onOpenChange, transaction, vendorName }: Props) {
  const receiptText = useReceiptText(open, { transactionId: transaction?.id });
  // A bad stored number shouldn't block the resend — fall back to WhatsApp's chat picker.
  const waUrl = receiptText
    ? (receiptWhatsappUrl(receiptText, transaction?.customerPhone) ?? receiptWhatsappUrl(receiptText))
    : null;

  if (!transaction) return null;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent data-testid="transaction-detail">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="truncate font-mono text-base">
            {transaction.billNumber}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {vendorName} · {formatIstDateTime(transaction.createdAt)} IST
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <ResponsiveDialogBody className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <PaymentMethodBadge method={transaction.paymentMethod} />
            <PaymentStatusBadge status={transaction.paymentStatus} />
          </div>

          <section aria-labelledby="tx-detail-items">
            <h3 id="tx-detail-items" className="mb-2 text-sm font-medium text-foreground">
              Items
            </h3>
            <ul className="divide-y rounded-md border">
              {transaction.orderItems.map((row) => (
                <li key={row.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-medium text-foreground">{row.name}</p>
                    <p className="text-sm tabular-nums text-muted-foreground">
                      {row.qty} × {formatINR(row.priceInPaise)}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-medium tabular-nums text-foreground">
                    {formatINR(row.totalPaise)}
                  </p>
                </li>
              ))}
            </ul>
          </section>

          <dl className="space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd className="tabular-nums">{formatINR(transaction.subtotalPaise)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="min-w-0 break-words text-muted-foreground">{discountLabel(transaction.offerName)}</dt>
              <dd className="shrink-0 tabular-nums">
                {transaction.discountPaise > 0 ? "−" : ""}
                {formatINR(transaction.discountPaise)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Tax</dt>
              <dd className="tabular-nums">{formatINR(transaction.taxPaise)}</dd>
            </div>
            <div className="flex justify-between border-t pt-2 text-base font-semibold">
              <dt>Total</dt>
              <dd className="tabular-nums">{formatINR(transaction.totalPaise)}</dd>
            </div>
          </dl>

          {(transaction.customerName || transaction.customerPhone) && (
            <div className="rounded-md border p-3 text-sm">
              <p className="font-medium text-foreground">Customer</p>
              {transaction.customerName ? <p className="break-words">{transaction.customerName}</p> : null}
              {transaction.customerPhone ? <p className="font-mono">{transaction.customerPhone}</p> : null}
            </div>
          )}

          {transaction.upiRef ? (
            <p className="break-all font-mono text-xs text-muted-foreground">UPI ref: {transaction.upiRef}</p>
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

          {receiptText === null ? (
            <p className="text-xs text-muted-foreground" role="status">
              Couldn&apos;t load the receipt. Close and reopen to try again.
            </p>
          ) : null}
        </ResponsiveDialogBody>

        {/* Pinned under the scrolling body, so both actions stay in reach on a long bill. */}
        <ResponsiveDialogFooter className="flex-col md:flex-row">
          <WhatsAppReceiptButton
            url={waUrl}
            loading={receiptText === undefined}
            label={transaction.customerPhone?.trim() ? "Resend on WhatsApp" : "Send on WhatsApp"}
            className="h-11 w-full md:flex-1"
          />
          <PrintReceiptLink billNumber={transaction.billNumber} className="h-11 w-full md:flex-1" />
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
