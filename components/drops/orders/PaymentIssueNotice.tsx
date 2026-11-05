"use client";

import { Ban, Check, Loader2, RotateCcw } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Notice } from "@/components/ui/notice";
import { formatINR } from "@/lib/currency";
import {
  issueOffersRefund,
  paymentIssueCopy,
  REFUND_MANAGER_ONLY,
  REFUND_TERMS,
  refundFailedMessage,
  type PaymentIssue,
} from "@/lib/payment-issue";

/**
 * A Razorpay payment that needs the seller's answer (lib/payment-issue.ts), on its
 * order card. A cashier reads what happened and who can sort it out; nothing here
 * acts for them. Rendered only for an open issue, so it goes once it is answered.
 */
export function PaymentIssueNotice({
  issue,
  billNumber,
  totalPaise,
  canRefund,
  canCancel,
  busy,
  pendingAction,
  onRefund,
  onKeep,
  onCancelAndRefund,
}: {
  issue: PaymentIssue;
  billNumber: string;
  totalPaise: number;
  canRefund: boolean;
  /** A late order that can still come off the list: opens the card's cancel dialog. */
  canCancel: boolean;
  busy: boolean;
  pendingAction: "refund_payment_issue" | "keep_payment_issue" | null;
  /** Resolves to the failure reason when Razorpay didn't take the refund. */
  onRefund: () => Promise<string | null>;
  onKeep: () => void;
  onCancelAndRefund: () => void;
}) {
  const [confirmRefund, setConfirmRefund] = useState(false);
  const [refundFailed, setRefundFailed] = useState<string | null>(null);
  const amount = formatINR(totalPaise);
  const copy = paymentIssueCopy(issue, amount);

  return (
    <Notice icon className="mt-3" data-testid="payment-issue">
      <p className="font-semibold">{copy.title}</p>
      <p className="mt-1">{copy.body}</p>
      {refundFailed && (
        <p role="alert" className="mt-2 font-semibold">
          {refundFailedMessage(refundFailed)}
        </p>
      )}
      {canRefund ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {issueOffersRefund(issue) && (
            <Button
              type="button"
              className="min-h-11 flex-1 basis-[45%] text-sm font-semibold"
              disabled={busy}
              aria-busy={pendingAction === "refund_payment_issue"}
              onClick={() => setConfirmRefund(true)}
            >
              {pendingAction === "refund_payment_issue" ? (
                <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
              ) : (
                <RotateCcw aria-hidden />
              )}
              Refund {amount}
            </Button>
          )}
          {canCancel && (
            <Button
              type="button"
              variant="outline"
              className="min-h-11 flex-1 basis-[45%] text-sm font-medium"
              disabled={busy}
              onClick={onCancelAndRefund}
            >
              <Ban aria-hidden />
              Cancel and refund {amount}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            className="min-h-11 flex-1 basis-[45%] text-sm font-medium"
            disabled={busy}
            aria-busy={pendingAction === "keep_payment_issue"}
            onClick={onKeep}
          >
            {pendingAction === "keep_payment_issue" ? (
              <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
            ) : (
              <Check aria-hidden />
            )}
            {copy.keepLabel}
          </Button>
        </div>
      ) : (
        <p className="mt-2 font-semibold">{REFUND_MANAGER_ONLY}</p>
      )}
      <ConfirmDialog
        open={confirmRefund}
        onOpenChange={setConfirmRefund}
        title={`Refund ${amount}?`}
        description={`${billNumber}. ${REFUND_TERMS}`}
        confirmLabel={`Refund ${amount}`}
        cancelLabel="Go back"
        destructive={false}
        onConfirm={() => {
          setRefundFailed(null);
          void onRefund().then(setRefundFailed);
        }}
      />
    </Notice>
  );
}
