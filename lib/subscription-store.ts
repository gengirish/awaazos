/**
 * The one write path for platform-subscription state
 * (docs/RAZORPAY_SUBSCRIPTIONS_PLAN.md). Used by the Razorpay webhook and by
 * the Checkout verify route, so both land a vendor in the same state.
 *
 * Idempotency: every call is recorded in `SubscriptionEvent` keyed on
 * `eventId`, in the same transaction as the vendor update. A replay hits the
 * unique index (P2002) and is reported as "duplicate" with no effect, so a
 * caller that fails for any other reason can safely be retried.
 *
 * Transitions themselves are the pure `applySubscriptionEvent`
 * (lib/subscription.ts). Server-only.
 */
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { claimReferralCreditInTx, earnReferralRewardInTx } from "@/lib/referral-server";
import {
  applySubscriptionEvent,
  type SubscriptionEventName,
  type SubscriptionSnapshot,
} from "@/lib/subscription";

export type RecordSubscriptionEventInput = {
  /** `x-razorpay-event-id`, or `verify:<payment_id>:<status>` from the verify route. */
  eventId: string;
  event: SubscriptionEventName;
  sub: SubscriptionSnapshot;
  /** `notes.vendorId` from the subscription; falls back to the stored sub id. */
  vendorId: string | null;
  paymentId?: string | null;
  amountPaise?: number | null;
};

export type RecordSubscriptionEventResult =
  | { kind: "applied"; vendorId: string }
  /** Recorded, but no vendor matches (deleted, or a subscription we don't know). */
  | { kind: "no_vendor" }
  | { kind: "duplicate" };

export async function recordSubscriptionEvent(
  input: RecordSubscriptionEventInput,
): Promise<RecordSubscriptionEventResult> {
  const { eventId, event, sub } = input;
  try {
    return await prisma.$transaction(async (tx) => {
      let vendorId = input.vendorId;
      if (!vendorId) {
        const row = await tx.vendorSettings.findFirst({
          where: { razorpaySubId: sub.id },
          select: { vendorId: true },
        });
        vendorId = row?.vendorId ?? null;
      }

      // Serialise events for one vendor so two can't both read the old
      // planExpiresAt. Also confirms the vendor still exists.
      const locked = vendorId
        ? await tx.$queryRaw<{ id: string }[]>`SELECT id FROM vendors WHERE id = ${vendorId} FOR UPDATE`
        : [];
      if (locked.length === 0) vendorId = null;

      await tx.subscriptionEvent.create({
        data: {
          vendorId,
          razorpayEventId: eventId,
          event,
          subscriptionId: sub.id,
          paymentId: input.paymentId ?? null,
          amountPaise: input.amountPaise ?? null,
          status: sub.status,
          currentEnd: sub.currentEnd,
        },
      });

      if (!vendorId) return { kind: "no_vendor" as const };

      const vendor = await tx.vendor.findUniqueOrThrow({
        where: { id: vendorId },
        select: { plan: true, planExpiresAt: true, settings: { select: { razorpaySubId: true } } },
      });
      const patch = applySubscriptionEvent(
        {
          plan: vendor.plan,
          planExpiresAt: vendor.planExpiresAt,
          razorpaySubId: vendor.settings?.razorpaySubId ?? null,
        },
        event,
        sub,
      );

      if (patch.vendor) {
        await tx.vendor.update({ where: { id: vendorId }, data: patch.vendor });
      }
      if (patch.settings) {
        await tx.vendorSettings.upsert({
          where: { vendorId },
          create: { vendorId, ...patch.settings },
          update: patch.settings,
        });
      }

      // Store-to-store referral (lib/referral.ts). Same transaction, so a
      // replayed event (P2002 on the ledger above) never reaches here.
      //  1. This store's own banked months pay back part or all of this charge
      //     (a ReferralCredit; the refund is sent after commit).
      //  2. The referred store's first charge that we keep money from earns its
      //     referrer free time; the reward is unique on the referred store.
      const chargePaise = input.amountPaise ?? 0;
      if (event === "subscription.charged" && chargePaise > 0 && sub.mapped) {
        const credit = await claimReferralCreditInTx(tx, {
          vendorId,
          sourceEventId: eventId,
          paymentId: input.paymentId,
          chargePaise,
          interval: sub.mapped.interval,
        });
        if (credit?.created) {
          console.info("[subscription-store] referral credit vendor=%s refund=%d", vendorId, credit.refundPaise);
        }
        if (chargePaise - (credit?.refundPaise ?? 0) > 0) {
          const reward = await earnReferralRewardInTx(tx, {
            referredVendorId: vendorId,
            sourceEventId: eventId,
            interval: sub.mapped.interval,
          });
          if (reward.kind === "earned") {
            console.info(
              "[subscription-store] referral reward earned referrer=%s referred=%s months=%d redeemed=%s",
              reward.referrerVendorId,
              vendorId,
              reward.months,
              reward.redeemed,
            );
          }
        }
      }
      return { kind: "applied" as const, vendorId };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { kind: "duplicate" };
    }
    throw e;
  }
}
