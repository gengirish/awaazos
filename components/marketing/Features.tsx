import {
  BellRing,
  CalendarClock,
  ClipboardList,
  ImageIcon,
  Link2,
  MessageCircle,
  Mic,
  PackageCheck,
  Printer,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Only what ships (CLAUDE.md, docs/ICP.md). Three lead, large; the rest are a compact
// list. Payments are told once, in OnlinePayments, so there is no payment card here.
const leadFeatures = [
  {
    icon: CalendarClock,
    title: "Drops with a cut-off",
    description:
      "Sell a batch ahead of time: Saturday bakes or festive gift boxes, order by Friday 9 pm. Ordering closes by itself at the cut-off.",
  },
  {
    icon: PackageCheck,
    title: "No overselling",
    description:
      "Set how many of each item you can make. Once they are taken, nobody else can order them. No apologies, no refunds.",
  },
  {
    icon: Mic,
    title: "Bills at the counter too",
    description:
      "Selling at a pop-up or from your door? Tap the items, or speak the order in English or Hindi (more languages are coming). Show a UPI QR and keep billing without a network.",
  },
] as const;

const moreFeatures = [
  {
    icon: Link2,
    title: "Store link for your bio",
    description: "Banner, logo, open drops and your everyday list, in one link for Instagram or WhatsApp.",
  },
  {
    icon: ClipboardList,
    title: "One orders board",
    description: "Every order from every drop and your everyday list. Confirm, mark paid and delivered, several at once.",
  },
  {
    icon: Printer,
    title: "Prep sheet or packing list",
    description: "What to make or pack and a delivery list for each drop, ready to print.",
  },
  {
    icon: ImageIcon,
    title: "Instagram story image",
    description: "A story-sized image of each drop with its items, prices and cut-off.",
  },
  {
    icon: BellRing,
    title: "Order alerts on your phone",
    description: "A notification when a new order or a payment reference comes in.",
  },
  {
    icon: MessageCircle,
    title: "Receipts on WhatsApp",
    description: "Sent from your own WhatsApp number, with a link the buyer can open any time.",
  },
] as const;

export function Features() {
  return (
    <section aria-labelledby="features-heading" className="bg-muted/40 px-4 py-16 sm:px-6 sm:py-20">
      <div className="mx-auto max-w-6xl">
        <h2 id="features-heading" className="font-display text-3xl font-bold text-balance text-awaaz-charcoal sm:text-4xl">
          From the first order to the handover
        </h2>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Built for home sellers on Instagram and WhatsApp: bakes, meal boxes and sweets, and herbal teas, wellness products, candles and crafts too.
        </p>
        <div className="mt-10 grid gap-6 lg:grid-cols-3">
          {leadFeatures.map((f) => {
            const Icon = f.icon;
            return (
              <Card key={f.title} className="border-border/80 bg-background shadow-xs">
                <CardHeader className="pb-2">
                  <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-lg bg-awaaz-orange/10 text-awaaz-orange">
                    <Icon className="h-7 w-7" aria-hidden="true" />
                  </div>
                  <CardTitle className="font-display text-xl text-awaaz-charcoal">{f.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="leading-relaxed text-muted-foreground">{f.description}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
        <h3 className="mt-12 font-display text-xl font-bold text-awaaz-charcoal">And everything around them</h3>
        <ul className="mt-4 grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
          {moreFeatures.map((f) => {
            const Icon = f.icon;
            return (
              <li key={f.title} className="flex gap-3">
                <Icon className="mt-0.5 h-5 w-5 shrink-0 text-awaaz-orange" aria-hidden="true" />
                <div>
                  <p className="font-semibold text-awaaz-charcoal">{f.title}</p>
                  <p className="text-sm leading-relaxed text-muted-foreground">{f.description}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
