import Link from "next/link";

import { Button } from "@/components/ui/button";
import { PLAN_MARKETING } from "@/lib/plan-copy";

/**
 * Pricing-page call to action. New visitors start the free trial (no card);
 * signed-in owners pick monthly or yearly on the billing page, which is the
 * one place a subscription is started.
 */
export function PricingPlanButtons({ signedIn }: { signedIn: boolean }) {
  if (signedIn) {
    return (
      <Button asChild className="min-h-11 w-full">
        <Link href="/settings/billing">Choose monthly or yearly</Link>
      </Button>
    );
  }
  return (
    <Button asChild className="min-h-11 w-full">
      <Link href="/sign-up">Start {PLAN_MARKETING.STARTER.trial}</Link>
    </Button>
  );
}
