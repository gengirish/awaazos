import Link from "next/link";
import { Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InstallAppButton } from "@/components/marketing/InstallAppButton";
import { PLAN_MARKETING } from "@/lib/plan-copy";

// Illustration only (aria-hidden): a buyer's view of one drop on the store page.
const mockItems = [
  { name: "Sourdough loaf", price: "₹320", note: "Only 3 left" },
  { name: "Cinnamon rolls, box of 4", price: "₹280", note: null },
] as const;

function StorefrontMockup() {
  return (
    <div
      className="relative mx-auto w-full max-w-[260px] rounded-[2.25rem] border-4 border-awaaz-charcoal bg-awaaz-charcoal p-2 shadow-2xl"
      aria-hidden="true"
    >
      <div className="relative overflow-hidden rounded-[1.75rem] bg-white pb-5">
        <div className="absolute left-1/2 top-3 h-1.5 w-16 -translate-x-1/2 rounded-full bg-white/60" />
        <div className="bg-linear-to-br from-awaaz-orange to-awaaz-orange/70 px-4 pb-4 pt-9">
          <p className="font-display text-base font-bold text-white">Meera&apos;s Bakes</p>
          <p className="text-xs text-white/90">Order here, pick up Saturday</p>
        </div>
        <div className="px-4 pt-4">
          <p className="font-display text-lg font-bold leading-tight text-awaaz-charcoal">Saturday bakes</p>
          <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-awaaz-orange/10 px-2.5 py-1 text-xs font-semibold text-awaaz-orange">
            <Clock className="h-3.5 w-3.5" />
            Order by Fri 9 pm
          </p>
          <ul className="mt-4 space-y-2">
            {mockItems.map((item) => (
              <li key={item.name} className="rounded-xl border bg-white p-3 shadow-xs">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-semibold text-awaaz-charcoal">{item.name}</p>
                  <p className="font-mono text-xs font-semibold text-awaaz-charcoal">{item.price}</p>
                </div>
                {item.note ? <p className="mt-1 text-xs font-medium text-awaaz-orange">{item.note}</p> : null}
              </li>
            ))}
          </ul>
          <div className="mt-4 flex h-11 items-center justify-center rounded-lg bg-awaaz-orange text-sm font-semibold text-white shadow-md">
            Pay ₹600 with UPI
          </div>
        </div>
      </div>
    </div>
  );
}

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-linear-to-b from-awaaz-cream/80 to-background px-4 pb-16 pt-10 sm:px-6 sm:pb-20 sm:pt-14">
      <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
        <div>
          <p className="font-display text-sm font-bold tracking-wide text-awaaz-orange">Bol. Bill. Becho.</p>
          <h1 className="mt-2 font-display text-4xl font-bold leading-tight tracking-tight text-balance text-awaaz-charcoal sm:text-5xl">
            Take pre-orders from Instagram without the DM chaos
          </h1>
          <p className="mt-4 max-w-xl text-lg text-awaaz-charcoal/85 sm:text-xl">
            For home kitchens and bakers. Put one store link in your bio: buyers order before your cut-off and pay
            by UPI, a limited batch never oversells, and every order lands on one board instead of in DMs and
            payment screenshots.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
            <Button
              asChild
              size="lg"
              className="min-h-12 min-w-[44px] bg-awaaz-orange px-8 text-base font-semibold text-white shadow-md hover:bg-awaaz-orange/90 focus-visible:ring-2 focus-visible:ring-awaaz-orange focus-visible:ring-offset-2"
            >
              <Link href="/sign-up">{PLAN_MARKETING.STARTER.cta}</Link>
            </Button>
            <p className="text-sm text-awaaz-charcoal/80">{PLAN_MARKETING.STARTER.ctaNote}</p>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
            <Badge variant="secondary" className="border border-border bg-white px-3 py-1 text-xs font-semibold">
              IntelliForge AI Product
            </Badge>
            <InstallAppButton />
          </div>
        </div>
        <div className="flex justify-center lg:justify-end">
          <StorefrontMockup />
        </div>
      </div>
    </section>
  );
}
