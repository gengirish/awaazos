import {
  BadgeIndianRupee,
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

// Only what ships (CLAUDE.md, docs/ICP.md). Pre-orders lead; the counter POS is one card.
const features = [
  {
    icon: CalendarClock,
    title: "Drops with a cut-off",
    description:
      "Sell a batch ahead of time: Saturday bakes, order by Friday 9 pm. Ordering closes by itself at the cut-off.",
  },
  {
    icon: Link2,
    title: "Store link for your bio",
    description:
      "One link with your banner, logo, open drops and everyday menu. Put it in your bio or send it on WhatsApp, so you stop answering “Menu?” in every chat.",
  },
  {
    icon: PackageCheck,
    title: "No overselling",
    description:
      "Set how many of each item you can make. Once they are taken, nobody else can order them. No apologies, no refunds.",
  },
  {
    icon: BadgeIndianRupee,
    title: "UPI, confirmed by you",
    description:
      "Buyers pay to your own UPI ID and tell you they have paid. You mark each payment received or not received. Pay on delivery works too.",
  },
  {
    icon: ClipboardList,
    title: "One orders board",
    description:
      "Every order from every drop and your menu in one list. Confirm, mark paid and mark delivered, one by one or several at once.",
  },
  {
    icon: Printer,
    title: "Prep sheet",
    description: "A cook list and a delivery list for each drop, ready to print before you start cooking.",
  },
  {
    icon: ImageIcon,
    title: "Instagram story image",
    description: "A story-sized image of each drop with its items, prices and cut-off, ready to share from your phone.",
  },
  {
    icon: BellRing,
    title: "Order alerts on your phone",
    description: "Turn on alerts and get a notification when a new order or a payment reference comes in.",
  },
  {
    icon: MessageCircle,
    title: "Receipts on WhatsApp",
    description:
      "Every bill has a receipt you send from your own WhatsApp number, with a link the buyer can open any time.",
  },
  {
    icon: Mic,
    title: "Also bills at the counter",
    description:
      "Selling at a pop-up or from your door? Speak the order in English or Hindi, show a UPI QR, and keep billing without a network. Offline sales sync when you are back online.",
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
          Built for kitchens that sell on Instagram and WhatsApp: bakes, meal boxes, snacks and sweets.
        </p>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => {
            const Icon = f.icon;
            return (
              <Card key={f.title} className="border-border/80 bg-background shadow-xs">
                <CardHeader className="pb-2">
                  <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-lg bg-awaaz-orange/10 text-awaaz-orange">
                    <Icon className="h-6 w-6" aria-hidden="true" />
                  </div>
                  <CardTitle className="font-display text-lg text-awaaz-charcoal">{f.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-relaxed text-muted-foreground">{f.description}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}
