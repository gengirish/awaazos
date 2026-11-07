import Link from "next/link";
import { Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PLAN_MARKETING, TRIAL_THEN_NOTE } from "@/lib/plan-copy";

type MockStore = {
  name: string;
  tagline: string;
  drop: string;
  cutOff: string;
  /** Line totals add up to `total`: a mockup with a wrong sum reads as a bug. */
  lines: readonly { qty: number; name: string; price: string; note: string | null }[];
  total: string;
};

// Illustration only (aria-hidden): a buyer's view of one drop on three kinds of store,
// so a candle maker or a herbal-tea seller sees themselves as well as a baker.
const mockStores: readonly MockStore[] = [
  {
    name: "Meera's Bakes",
    tagline: "Order here, pick up Saturday",
    drop: "Saturday bakes",
    cutOff: "Order by Fri 9 pm",
    lines: [
      { qty: 1, name: "Sourdough loaf", price: "₹320", note: "Only 3 left" },
      { qty: 1, name: "Cinnamon rolls, box of 4", price: "₹280", note: null },
    ],
    total: "₹600",
  },
  {
    name: "Tulsi & Thyme",
    tagline: "Small-batch herbal teas",
    drop: "Winter wellness box",
    cutOff: "Order by Sun 8 pm",
    lines: [
      { qty: 2, name: "Tulsi ginger tea", price: "₹360", note: null },
      { qty: 1, name: "Wildflower honey jar", price: "₹240", note: "Only 2 left" },
    ],
    total: "₹600",
  },
  {
    name: "Little Flame Studio",
    tagline: "Hand-poured soy candles",
    drop: "Diwali gift collection",
    cutOff: "Order by Wed 6 pm",
    lines: [
      { qty: 2, name: "Sandalwood jar candle", price: "₹500", note: "Only 4 left" },
      { qty: 1, name: "Wax melts, set of 6", price: "₹100", note: null },
    ],
    total: "₹600",
  },
];

/**
 * Each store shows for 5 s of a 15 s loop (`animate-hero-store`, app/globals.css),
 * the negative delays putting them a third of a loop apart. With reduced motion
 * only the first store shows.
 */
const ROTATION = ["", "opacity-0 motion-safe:[animation-delay:-10s]", "opacity-0 motion-safe:[animation-delay:-5s]"];

function StoreScreen({ store, className }: { store: MockStore; className: string }) {
  return (
    <div className={cn("overflow-hidden rounded-[1.75rem] bg-white pb-5 [grid-area:1/1]", className)}>
      <div className="bg-linear-to-br from-awaaz-orange to-awaaz-orange/70 px-4 pb-4 pt-9">
        <p className="font-display text-base font-bold text-white">{store.name}</p>
        <p className="text-sm text-white/90">{store.tagline}</p>
      </div>
      <div className="px-4 pt-4">
        <p className="font-display text-lg font-bold leading-tight text-awaaz-charcoal">{store.drop}</p>
        <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-awaaz-orange/10 px-2.5 py-1 text-sm font-semibold text-awaaz-orange">
          <Clock className="h-3.5 w-3.5" />
          {store.cutOff}
        </p>
        <ul className="mt-4 space-y-2">
          {store.lines.map((line) => (
            <li key={line.name} className="rounded-xl border bg-white p-3 shadow-xs">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-awaaz-charcoal">
                  {line.qty} × {line.name}
                </p>
                <p className="font-mono text-sm font-semibold text-awaaz-charcoal">{line.price}</p>
              </div>
              {line.note ? <p className="mt-1 text-sm font-medium text-awaaz-orange">{line.note}</p> : null}
            </li>
          ))}
        </ul>
        <div className="mt-4 flex h-11 items-center justify-center rounded-lg bg-awaaz-orange text-sm font-semibold text-white shadow-md">
          Pay {store.total} online
        </div>
      </div>
    </div>
  );
}

function StorefrontMockup() {
  return (
    <div
      className="relative mx-auto w-full max-w-[272px] rounded-[2.25rem] border-4 border-awaaz-charcoal bg-awaaz-charcoal p-2 shadow-2xl"
      aria-hidden="true"
    >
      <div className="relative grid">
        {mockStores.map((store, i) => (
          <StoreScreen
            key={store.name}
            store={store}
            className={cn(i > 0 && "motion-reduce:invisible", "motion-safe:animate-hero-store", ROTATION[i])}
          />
        ))}
        <div className="absolute left-1/2 top-3 h-1.5 w-16 -translate-x-1/2 rounded-full bg-white/60" />
      </div>
    </div>
  );
}

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-linear-to-b from-awaaz-cream/80 to-background px-4 pb-16 pt-10 sm:px-6 sm:pb-20 sm:pt-14">
      <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
        <div>
          <p className="font-display text-xl font-bold tracking-wide text-awaaz-orange sm:text-2xl">Bol. Bill. Becho.</p>
          <h1 className="mt-2 font-display text-4xl font-bold leading-tight tracking-tight text-balance text-awaaz-charcoal sm:text-5xl">
            Take orders from Instagram and WhatsApp without the chat chaos
          </h1>
          <p className="mt-4 max-w-xl text-lg text-awaaz-charcoal/85 sm:text-xl">
            Tell AwaazOS what you&apos;re making this Saturday, by voice or by typing. It builds your store link, takes the
            orders and gets you paid.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
            <Button
              asChild
              size="lg"
              className="min-h-12 min-w-[44px] bg-awaaz-orange px-8 text-base font-semibold text-white shadow-md hover:bg-awaaz-orange/90 focus-visible:ring-2 focus-visible:ring-awaaz-orange focus-visible:ring-offset-2"
            >
              <Link href="/sign-up">{PLAN_MARKETING.STARTER.cta}</Link>
            </Button>
            <p className="text-sm text-awaaz-charcoal/80">{TRIAL_THEN_NOTE}</p>
          </div>
          <div className="mt-6">
            <Badge variant="secondary" className="border border-border bg-white px-3 py-1 text-sm font-semibold">
              For bakers, home kitchens and home businesses of every kind
            </Badge>
          </div>
        </div>
        <div className="flex justify-center lg:justify-end">
          <StorefrontMockup />
        </div>
      </div>
    </section>
  );
}
