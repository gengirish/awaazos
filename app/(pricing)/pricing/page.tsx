import type { Metadata } from "next";
import Link from "next/link";

import { PricingPlanButtons } from "@/components/billing/PricingPlanButtons";
import { auth } from "@/lib/auth";
import { TRIAL_DAYS } from "@/lib/constants";
import { MARKETED_PLANS, PLAN_COMPARISON, PLAN_MARKETING, YEARLY_DISCOUNT } from "@/lib/plan-copy";

const starter = PLAN_MARKETING.STARTER;

export const metadata: Metadata = {
  title: "Pricing — AwaazOS",
  description: `${starter.trial}, then plans from ${PLAN_MARKETING.LITE.price}. A store link for your Instagram bio, drops with a cut-off, and UPI orders on one board.`,
};

// A free trial, then Lite, Starter or Pro, monthly or yearly. FREE (grandfathered
// vendors only) and ENTERPRISE stay in `lib/constants` for the gates but never on
// the marketing surface. Copy is shared with the landing teaser via lib/plan-copy.ts.
const VISIBLE_TIERS = MARKETED_PLANS;

export default async function PricingPage() {
  const session = await auth();
  const signedIn = Boolean(session?.user);

  return (
    <div className="min-h-screen bg-background px-4 py-10 md:px-6">
      <div className="mx-auto max-w-5xl">
        <header className="mb-10 text-center">
          <h1 className="font-display text-3xl font-semibold text-balance text-foreground sm:text-4xl md:text-5xl">
            {starter.trial}. Then pick your plan.
          </h1>
          <p className="mt-3 text-muted-foreground">
            Orders, UPI billing and receipts for home kitchens and home sellers on Instagram and WhatsApp. Try everything
            for {TRIAL_DAYS} days on {starter.label}, no card needed. Subscribe only if it earns its place in your
            business.
          </p>
        </header>

        <div className="mx-auto grid max-w-md gap-6 md:max-w-none md:grid-cols-3">
          {VISIBLE_TIERS.map((tier) => (
            <section
              key={tier}
              className={`flex flex-col rounded-xl border bg-card p-6 shadow-xs ${
                PLAN_MARKETING[tier].emphasis ? "ring-2 ring-awaaz-orange ring-offset-2 ring-offset-background" : ""
              }`}
            >
              {PLAN_MARKETING[tier].badge ? (
                <p className="mb-1 text-sm font-semibold uppercase tracking-wider text-primary">
                  {PLAN_MARKETING[tier].badge}
                </p>
              ) : null}
              <h2 className="font-display text-xl font-semibold">{PLAN_MARKETING[tier].label}</h2>
              <p className="mt-2 text-3xl font-bold tracking-tight">{PLAN_MARKETING[tier].price}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                or <span className="font-medium text-foreground">{PLAN_MARKETING[tier].yearlyPrice}</span> —{" "}
                {PLAN_MARKETING[tier].yearlyNote}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Save {PLAN_MARKETING[tier].yearlySaving}, about {PLAN_MARKETING[tier].yearlyPerMonth} a month.
              </p>
              <p className="mt-4 text-sm text-muted-foreground">{PLAN_MARKETING[tier].summary}</p>
              <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-foreground">
                {PLAN_MARKETING[tier].bullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
              <div className="mt-6 flex flex-1 flex-col justify-end gap-4">
                <PricingPlanButtons signedIn={signedIn} plan={tier} />
              </div>
            </section>
          ))}
        </div>

        <section aria-labelledby="compare-plans-heading" className="mt-12">
          <h2 id="compare-plans-heading" className="font-display text-2xl font-semibold text-foreground">
            Compare plans
          </h2>
          <div className="mt-4 overflow-x-auto rounded-lg border bg-card">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th scope="col" className="px-3 py-3 text-left font-medium">
                    <span className="sr-only">Feature</span>
                  </th>
                  <th scope="col" className="px-3 py-3 text-left font-medium">
                    {PLAN_MARKETING.LITE.label}
                  </th>
                  <th scope="col" className="px-3 py-3 text-left font-semibold text-primary">
                    {starter.label}
                  </th>
                  <th scope="col" className="px-3 py-3 text-left font-medium">
                    {PLAN_MARKETING.PRO.label}
                  </th>
                </tr>
              </thead>
              <tbody>
                {PLAN_COMPARISON.map((row) => (
                  <tr key={row.label} className="border-b last:border-0">
                    <th scope="row" className="px-3 py-2.5 text-left font-normal text-muted-foreground">
                      {row.label}
                    </th>
                    <td className="px-3 py-2.5">{row.lite}</td>
                    <td className="px-3 py-2.5 font-medium">{row.starter}</td>
                    <td className="px-3 py-2.5">{row.pro}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Prices exclude 18% GST. Yearly plans get {starter.yearlyNote} ({YEARLY_DISCOUNT}). Cancel anytime — your plan runs to the end of the period you paid for. See the{" "}
          <Link href="/legal/refund" className="underline underline-offset-4">
            refund policy
          </Link>
          .
        </p>

        {/* HIDDEN — see PITCH.md "minimal product" cut list. Re-enable when STARTER GA.
        <div className="mt-12 overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[600px] border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium">Feature</th>
                <th className="px-4 py-3 text-left font-medium">Free</th>
                <th className="px-4 py-3 text-left font-medium">Starter</th>
                <th className="px-4 py-3 text-left font-medium">Pro</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className="border-b last:border-0">
                  <td className="px-4 py-3">{r.label}</td>
                  <td className="px-4 py-3 text-muted-foreground">{r.free}</td>
                  <td className="px-4 py-3 text-muted-foreground">{r.starter}</td>
                  <td className="px-4 py-3 text-muted-foreground">{r.pro}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-8 text-center text-sm text-muted-foreground">
          Need Enterprise (custom SLA, dedicated support)?{" "}
          <span className="font-medium text-foreground">Contact us</span> — we'll tailor a plan.
        </p>
        */}
      </div>
    </div>
  );
}
