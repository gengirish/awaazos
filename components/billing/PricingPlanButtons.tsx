import Link from "next/link";

import { Button } from "@/components/ui/button";
import { billingSelectionPath } from "@/lib/billing-actions";
import { PLAN_LIMITS } from "@/lib/constants";
import { PLAN_MARKETING } from "@/lib/plan-copy";
import type { SubscribablePlan } from "@/lib/subscription";

/**
 * Pricing-page call to action. It carries the pick to the billing page, which is
 * the one place a subscription is started. A new visitor starts the free trial
 * (no card) and goes through onboarding, so sign-up carries no pick; someone who
 * already has a store signs in and lands on it.
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
  const signInHref = `/sign-in?callbackUrl=${encodeURIComponent(billingSelectionPath(plan, "monthly"))}`;
  return (
    <div className="flex flex-col gap-2">
      <Button asChild className="min-h-11 w-full">
        <Link href="/sign-up">Start {PLAN_MARKETING.STARTER.trial}</Link>
      </Button>
      <Button asChild variant="ghost" className="min-h-11 w-full">
        <Link href={signInHref}>Have a store? Sign in to choose {label}</Link>
      </Button>
    </div>
  );
}
