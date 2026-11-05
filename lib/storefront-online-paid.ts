/**
 * On a Razorpay store the seller hears about a UPI order when the money is in, not
 * when the buyer taps Place order: most of what's unpaid at that point never needs
 * them. A buyer who pays directly instead still sends the "Customer says paid" alert.
 *
 * The caller runs `alertSellerOnlinePaid` only when it won `markOrderPaid` (true
 * exactly once per order), so verify and the webhook can't both alert. By then the
 * payment is booked: nothing here may fail the caller, or Razorpay would retry.
 */

import { bumpOrderSignal } from "@/lib/drops-signal";
import { prisma } from "@/lib/prisma";
import { newPaidOrderPayload, notifyVendorInBackground } from "@/lib/push";

/** Whether placing this order is the moment to tell the seller. */
export function alertsAtPlacement(paymentMethod: "UPI" | "CASH", takesOnlinePayment: boolean): boolean {
  return paymentMethod === "CASH" || !takesOnlinePayment;
}

export async function alertSellerOnlinePaid(vendorId: string, transactionId: string): Promise<void> {
  void bumpOrderSignal(vendorId);
  try {
    const t = await prisma.transaction.findFirst({
      where: { id: transactionId, vendorId },
      select: { billNumber: true, totalPaise: true, dropId: true, orderItems: { select: { qty: true } } },
    });
    if (!t) return;
    notifyVendorInBackground(
      vendorId,
      newPaidOrderPayload({
        billNumber: t.billNumber,
        totalPaise: t.totalPaise,
        itemCount: t.orderItems.reduce((n, i) => n + i.qty, 0),
        dropId: t.dropId,
      }),
    );
  } catch (e) {
    console.warn(
      JSON.stringify({
        event: "storefront_rzp_paid_alert_failed",
        vendorId,
        transactionId,
        error: e instanceof Error ? e.name : "unknown",
      }),
    );
  }
}
