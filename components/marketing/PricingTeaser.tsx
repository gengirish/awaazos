import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { MARKETED_PLANS, PLAN_MARKETING } from "@/lib/plan-copy";

// Tier copy lives in lib/plan-copy.ts (one source with the pricing page). One plan is sold.
const tiers = MARKETED_PLANS.map((plan) => ({ name: plan, ...PLAN_MARKETING[plan] }));

export function PricingTeaser() {
  return (
    <section aria-labelledby="pricing-teaser-heading" className="px-4 py-16 sm:px-6 sm:py-20">
      <div className="mx-auto max-w-6xl">
        <h2 id="pricing-teaser-heading" className="font-display text-3xl font-bold text-awaaz-charcoal sm:text-4xl">
          One simple plan for every vendor
        </h2>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          {PLAN_MARKETING.STARTER.trial}. Then {PLAN_MARKETING.STARTER.price}, or{" "}
          {PLAN_MARKETING.STARTER.yearlyPrice} ({PLAN_MARKETING.STARTER.yearlyNote}). No upsells.
        </p>
        <div className="mt-10 grid max-w-md gap-6">
          {tiers.map((tier) => (
            <Card
              key={tier.name}
              className={
                tier.emphasis
                  ? "border-2 border-awaaz-orange bg-awaaz-cream/30 shadow-md"
                  : "border-border/80 bg-card shadow-xs"
              }
            >
              <CardHeader>
                <CardTitle className="font-display text-lg text-awaaz-charcoal">{tier.label}</CardTitle>
                <p className="mt-2 font-display text-3xl font-bold text-awaaz-charcoal">
                  {tier.amount}
                  <span className="text-base font-normal text-muted-foreground">
                    {tier.period} {tier.taxNote}
                  </span>
                </p>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{tier.teaser}</p>
              </CardContent>
              <CardFooter className="pt-2">
                <Button
                  asChild
                  variant={tier.emphasis ? "default" : "outline"}
                  className={
                    tier.emphasis
                      ? "min-h-11 w-full bg-awaaz-orange font-semibold text-white hover:bg-awaaz-orange/90 focus-visible:ring-2 focus-visible:ring-awaaz-orange focus-visible:ring-offset-2"
                      : "min-h-11 w-full focus-visible:ring-2 focus-visible:ring-awaaz-orange focus-visible:ring-offset-2"
                  }
                >
                  <Link href="/sign-up">Start {tier.trial}</Link>
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
        <div className="mt-10 text-center">
          <Link
            href="/pricing"
            className="inline-flex min-h-11 items-center justify-center rounded-md px-4 text-base font-semibold text-awaaz-orange underline-offset-4 outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-awaaz-orange focus-visible:ring-offset-2"
          >
            See pricing →
          </Link>
        </div>
      </div>
    </section>
  );
}
