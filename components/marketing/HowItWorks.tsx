import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const steps = [
  {
    emoji: "🎤",
    title: "Bol",
    description: "Speak the order in any Indian language — natural and fast.",
  },
  {
    emoji: "🧾",
    title: "Bill",
    description: "AI turns speech into a clean bill with items and totals.",
  },
  {
    emoji: "📲",
    title: "Becho",
    description: "Customer pays with UPI QR; receipts go out on WhatsApp.",
  },
] as const;

export function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-heading" className="px-4 py-16 sm:px-6 sm:py-20">
      <div className="mx-auto max-w-6xl">
        <h2 id="how-heading" className="font-display text-3xl font-bold text-awaaz-charcoal sm:text-4xl">
          How it works
        </h2>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Three simple steps from voice to payment — built for busy stalls and small shops.
        </p>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {steps.map((step) => (
            <Card key={step.title} className="border-border/80 bg-card shadow-xs">
              <CardHeader className="pb-2">
                <div className="mb-2 text-3xl" aria-hidden="true">
                  {step.emoji}
                </div>
                <CardTitle className="font-display text-xl text-awaaz-charcoal">{step.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed text-muted-foreground">{step.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
