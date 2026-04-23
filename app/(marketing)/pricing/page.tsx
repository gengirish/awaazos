import type { Metadata } from "next";

import { PricingPlanButtons } from "@/components/billing/PricingPlanButtons";
import { auth } from "@/lib/auth";
import { PLAN_LIMITS, PLAN_PRICES_PAISE } from "@/lib/constants";
import { formatINR } from "@/lib/currency";

export const metadata: Metadata = {
  title: "Pricing — AwaazOS",
  description: "Simple plans for voice-first billing. Start free, upgrade when you grow.",
};

function priceLabel(plan: "FREE" | "STARTER" | "PRO") {
  const paise = PLAN_PRICES_PAISE[plan];
  if (plan === "FREE") return formatINR(paise);
  if (plan === "PRO" || plan === "STARTER") return `${formatINR(paise)}/mo`;
  return formatINR(paise);
}

export default async function PricingPage() {
  const session = await auth();
  const signedIn = Boolean(session?.user);

  const rows: { label: string; free: string; starter: string; pro: string }[] = [
    {
      label: "Bills per month",
      free: String(PLAN_LIMITS.FREE.monthlyTxnCap ?? "—"),
      starter: String(PLAN_LIMITS.STARTER.monthlyTxnCap ?? "—"),
      pro: "Unlimited",
    },
    {
      label: "Staff seats",
      free: String(PLAN_LIMITS.FREE.maxStaff ?? "—"),
      starter: String(PLAN_LIMITS.STARTER.maxStaff ?? "—"),
      pro: "Unlimited",
    },
    {
      label: "WhatsApp receipts",
      free: PLAN_LIMITS.FREE.whatsapp ? "Yes" : "—",
      starter: "Yes",
      pro: "Yes",
    },
    {
      label: "Razorpay payment links",
      free: "—",
      starter: "—",
      pro: "Yes",
    },
    {
      label: "CSV export",
      free: "—",
      starter: "—",
      pro: "Yes",
    },
    {
      label: "Sarvam STT (te/kn/ta)",
      free: "—",
      starter: "Yes",
      pro: "Yes",
    },
    {
      label: "Analytics history",
      free: `${PLAN_LIMITS.FREE.analyticsDays} days`,
      starter: `${PLAN_LIMITS.STARTER.analyticsDays} days`,
      pro: `${PLAN_LIMITS.PRO.analyticsDays} days`,
    },
  ];

  return (
    <div className="min-h-screen bg-background px-4 py-10 md:px-6">
      <div className="mx-auto max-w-5xl">
        <header className="mb-10 text-center">
          <h1 className="font-display text-3xl font-semibold text-foreground md:text-4xl">Pricing</h1>
          <p className="mt-2 text-muted-foreground">
            Voice-first POS for Indian vendors. All prices in INR, excluding GST as applicable.
          </p>
        </header>

        <div className="grid gap-6 md:grid-cols-3">
          {(["FREE", "STARTER", "PRO"] as const).map((tier) => (
            <section
              key={tier}
              className={`flex flex-col rounded-xl border bg-card p-6 shadow-sm ${
                tier === "STARTER" ? "ring-2 ring-[#FF6B00] ring-offset-2 ring-offset-background" : ""
              }`}
            >
              <h2 className="font-display text-xl font-semibold">{PLAN_LIMITS[tier].label}</h2>
              <p className="mt-2 text-3xl font-bold tracking-tight">{priceLabel(tier)}</p>
              <p className="mt-4 text-sm text-muted-foreground">
                {tier === "FREE" && "Try AwaazOS on your stall — voice billing and UPI QR."}
                {tier === "STARTER" && "WhatsApp receipts, Sarvam STT, higher limits."}
                {tier === "PRO" && "Payment links, CSV export, unlimited scale for busy counters."}
              </p>
              <div className="mt-6 flex flex-1 flex-col justify-end gap-4">
                <PricingPlanButtons tier={tier} signedIn={signedIn} />
              </div>
            </section>
          ))}
        </div>

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
          <span className="font-medium text-foreground">Contact us</span> — we&apos;ll tailor a plan.
        </p>
      </div>
    </div>
  );
}
