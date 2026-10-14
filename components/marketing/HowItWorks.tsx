import { CalendarClock, ClipboardList, Share2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const steps = [
  {
    icon: CalendarClock,
    title: "Build a drop",
    description:
      "List what you are making, the price, how many you can make and the order-by time. Type it in, or say it in English or Hindi.",
  },
  {
    icon: Share2,
    title: "Share the link",
    description:
      "Put your store link in your Instagram bio and share the ready-made story image. Buyers order there, not in your DMs.",
  },
  {
    icon: ClipboardList,
    title: "Orders on one board",
    description:
      "Orders and UPI payments arrive on one board. Confirm each payment, print the prep sheet and hand over.",
  },
] as const;

export function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-heading" className="px-4 py-16 sm:px-6 sm:py-20">
      <div className="mx-auto max-w-6xl">
        <h2 id="how-heading" className="font-display text-3xl font-bold text-balance text-awaaz-charcoal sm:text-4xl">
          How it works
        </h2>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Three steps from &ldquo;taking orders for Saturday&rdquo; to a paid, packed batch.
        </p>
        <ol className="mt-10 grid gap-6 md:grid-cols-3">
          {steps.map((step) => {
            const Icon = step.icon;
            return (
              <li key={step.title}>
                <Card className="h-full border-border/80 bg-card shadow-xs">
                  <CardHeader className="pb-2">
                    <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-lg bg-awaaz-orange/10 text-awaaz-orange">
                      <Icon className="h-6 w-6" aria-hidden="true" />
                    </div>
                    <CardTitle className="font-display text-xl text-awaaz-charcoal">{step.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm leading-relaxed text-muted-foreground">{step.description}</p>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
