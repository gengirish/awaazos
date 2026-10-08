import type { Metadata } from "next";

import { PricingPlanButtons } from "@/components/billing/PricingPlanButtons";
import { auth } from "@/lib/auth";
import { MARKETED_PLANS, PLAN_MARKETING } from "@/lib/plan-copy";

export const metadata: Metadata = {
  title: "Pricing — AwaazOS",
  description: "₹299/mo. Speak the order. Print the bill. Take UPI. Done.",
};

// PRO and ENTERPRISE are not sold: they stay in `lib/constants` (PLAN_PRICES_PAISE,
// PLAN_LIMITS, PLAN_RANK) and in the Razorpay routes for the gates, but never on the
// marketing surface. Tier copy is shared with the landing teaser via lib/plan-copy.ts.
const VISIBLE_TIERS = MARKETED_PLANS;

export default async function PricingPage() {
  const session = await auth();
  const signedIn = Boolean(session?.user);

  return (
    <div className="min-h-screen bg-background px-4 py-10 md:px-6">
      <div className="mx-auto max-w-3xl">
        <header className="mb-10 text-center">
          <h1 className="font-display text-4xl font-semibold text-foreground md:text-5xl">
            ₹299/mo. Speak. Bill. Done.
          </h1>
          <p className="mt-3 text-muted-foreground">
            Voice-first POS for Indian vendors. Start free, upgrade when your counter gets busy.
          </p>
        </header>

        <div className="grid gap-6 md:grid-cols-2">
          {VISIBLE_TIERS.map((tier) => (
            <section
              key={tier}
              className={`flex flex-col rounded-xl border bg-card p-6 shadow-sm ${
                PLAN_MARKETING[tier].emphasis ? "ring-2 ring-[#FF6B00] ring-offset-2 ring-offset-background" : ""
              }`}
            >
              <h2 className="font-display text-xl font-semibold">{PLAN_MARKETING[tier].label}</h2>
              <p className="mt-2 text-3xl font-bold tracking-tight">{PLAN_MARKETING[tier].price}</p>
              <p className="mt-4 text-sm text-muted-foreground">{PLAN_MARKETING[tier].summary}</p>
              <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-foreground">
                {PLAN_MARKETING[tier].bullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
              <div className="mt-6 flex flex-1 flex-col justify-end gap-4">
                <PricingPlanButtons tier={tier} signedIn={signedIn} />
              </div>
            </section>
          ))}
        </div>

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
