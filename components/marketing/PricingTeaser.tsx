import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { MARKETED_PLANS, PLAN_MARKETING, TRIAL_END_NOTE } from "@/lib/plan-copy";

// Tier copy lives in lib/plan-copy.ts (one source with the pricing page).
const tiers = MARKETED_PLANS.map((plan) => ({ name: plan, ...PLAN_MARKETING[plan] }));

export function PricingTeaser() {
  return (
    <section aria-labelledby="pricing-teaser-heading" className="px-4 py-16 sm:px-6 sm:py-20">
      <div className="mx-auto max-w-6xl">
        <h2 id="pricing-teaser-heading" className="font-display text-3xl font-bold text-balance text-awaaz-charcoal sm:text-4xl">
          Simple plans
        </h2>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          {TRIAL_END_NOTE} Yearly gets you {PLAN_MARKETING.STARTER.yearlyNote}.
        </p>
        <div className="mt-10 grid max-w-md gap-6 md:max-w-none md:grid-cols-3">
          {tiers.map((tier) => (
            <Card
              key={tier.name}
              className={
                tier.emphasis
                  ? "relative border-2 border-awaaz-orange bg-awaaz-cream/30 shadow-md"
                  : "relative border-border/80 bg-card shadow-xs"
              }
            >
              {/* On the card's top border, so in one column it can't read as the card above's. */}
              {tier.badge ? (
                <p className="absolute -top-3 left-6 rounded-full bg-awaaz-orange px-3 py-0.5 text-sm font-semibold text-white shadow-xs">
                  {tier.badge}
                </p>
              ) : null}
              <CardHeader>
                <CardTitle className="font-display text-lg text-awaaz-charcoal">{tier.label}</CardTitle>
                <p className="mt-2 font-display text-3xl font-bold text-awaaz-charcoal">
                  {tier.amount}
                  <span className="text-base font-normal text-muted-foreground">
                    {tier.period} {tier.taxNote}
                  </span>
                </p>
                <p className="text-sm text-muted-foreground">
                  or <span className="font-medium text-awaaz-charcoal">{tier.yearlyPrice}</span>, {tier.yearlyNote}
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
                  <Link href="/sign-up">{tier.cta}</Link>
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
        <div className="mt-10 text-center">
          <Link
            href="/pricing"
            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md px-4 text-base font-semibold text-awaaz-orange underline-offset-4 outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-awaaz-orange focus-visible:ring-offset-2"
          >
            See pricing
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}
