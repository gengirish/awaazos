import type { PaymentMethod, PaymentStatus } from "@prisma/client";
import { Check, Clock, Undo2, X, type LucideIcon } from "lucide-react";

import { badgeVariants } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Same wording as the filter options, so a badge and the filter that finds it read alike. */
export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  UPI: "UPI",
  CASH: "Cash",
  CARD: "Card",
  RAZORPAY_LINK: "Razorpay link",
};

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  PENDING: "Pending",
  PAID: "Paid",
  FAILED: "Failed",
  REFUNDED: "Refunded",
};

const STATUS_STYLE: Record<
  PaymentStatus,
  { variant: "default" | "secondary" | "destructive"; Icon: LucideIcon }
> = {
  PAID: { variant: "default", Icon: Check },
  PENDING: { variant: "secondary", Icon: Clock },
  FAILED: { variant: "destructive", Icon: X },
  REFUNDED: { variant: "destructive", Icon: Undo2 },
};

/*
  Both badges are <span>s (not the <div> Badge primitive) so they are valid
  inside the phone list's row <button>.
*/

export function PaymentMethodBadge({ method, className }: { method: PaymentMethod; className?: string }) {
  return (
    <span className={cn(badgeVariants({ variant: "outline" }), "whitespace-nowrap", className)}>
      {PAYMENT_METHOD_LABEL[method]}
    </span>
  );
}

/** Status as icon + word; the colour only reinforces it. */
export function PaymentStatusBadge({ status, className }: { status: PaymentStatus; className?: string }) {
  const { variant, Icon } = STATUS_STYLE[status];
  return (
    <span className={cn(badgeVariants({ variant }), "gap-1 whitespace-nowrap", className)}>
      <Icon className="size-3 shrink-0" aria-hidden="true" />
      {PAYMENT_STATUS_LABEL[status]}
    </span>
  );
}
