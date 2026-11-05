import Link from "next/link";

import { Button } from "@/components/ui/button";
import { billingSelectionPath } from "@/lib/billing-actions";
import { PLAN_LIMITS } from "@/lib/constants";
import { PLAN_MARKETING } from "@/lib/plan-copy";
import type { BillingInterval, SubscribablePlan } from "@/lib/subscription";

function signUpHref(plan: SubscribablePlan, interval: BillingInterval): string {
  return `/sign-up?callbackUrl=${encodeURIComponent(billingSelectionPath(plan, interval))}`;
}

/**
 * Pricing-page call to action. It carries the pick to the billing page, which is
 * the one place a subscription is started. New visitors start the free trial
 * (no card) first and land there afterwards; sign-up keeps the pick through.
 */
export function PricingPlanButtons({ signedIn, plan }: { signedIn: boolean; plan: SubscribablePlan }) {
  const label = PLAN_LIMITS[plan].label;
  if (signedIn) {
    return (
      <div className="flex flex-col gap-2">
        <Button asChild className="min-h-11 w-full">
          <Link href={billingSelectionPath(plan, "monthly")}>Choose {label} monthly</Link>
        </Button>
        <Button asChild variant="outline" className="min-h-11 w-full">
          <Link href={billingSelectionPath(plan, "yearly")}>Choose {label} yearly</Link>
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <Button asChild className="min-h-11 w-full">
        <Link href={signUpHref(plan, "monthly")}>Start {PLAN_MARKETING.STARTER.trial}</Link>
      </Button>
      <Button asChild variant="ghost" className="min-h-11 w-full">
        <Link href={signUpHref(plan, "yearly")}>Start free, then {label} yearly</Link>
      </Button>
    </div>
  );
}
