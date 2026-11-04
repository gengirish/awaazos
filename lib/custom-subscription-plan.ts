/**
 * The Razorpay plan for a store's price. Razorpay plans are immutable and their
 * amount is fixed, so a custom price (`Vendor.customPricePaise`, set on
 * /admin/vendors) needs a plan of its own. Stores at the same price share one.
 *
 * Made when the owner subscribes, never on a timer and never when the admin
 * saves: most prices set won't be subscribed to. Rules for the price itself are
 * in lib/subscription.ts. Server-only.
 */
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { createRazorpayPlan, getRazorpayPlanId } from "@/lib/razorpay";
import {
  storeBasePaise,
  storeChargePaise,
  type BillingInterval,
  type SubscribablePlan,
} from "@/lib/subscription";

export async function resolveSubscriptionPlanId(input: {
  plan: SubscribablePlan;
  interval: BillingInterval;
  customPricePaise: number | null;
}): Promise<string> {
  const { plan, interval, customPricePaise } = input;
  // No custom price: the list plan, and the plan's env vars say which.
  if (customPricePaise === null) return getRazorpayPlanId(plan, interval);

  const basePaise = storeBasePaise(interval, customPricePaise);
  const key = { basePaise, interval };
  const existing = await prisma.customRazorpayPlan.findUnique({
    where: { basePaise_interval: key },
    select: { razorpayPlanId: true },
  });
  if (existing) return existing.razorpayPlanId;

  const razorpayPlanId = await createRazorpayPlan({
    plan,
    interval,
    basePaise,
    amountPaise: storeChargePaise(interval, customPricePaise),
  });
  try {
    await prisma.customRazorpayPlan.create({ data: { ...key, razorpayPlanId } });
    return razorpayPlanId;
  } catch (err) {
    // Another owner at this price got there first: use theirs. The plan just
    // made stays unused at Razorpay, which is harmless.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const winner = await prisma.customRazorpayPlan.findUniqueOrThrow({
        where: { basePaise_interval: key },
        select: { razorpayPlanId: true },
      });
      return winner.razorpayPlanId;
    }
    throw err;
  }
}
