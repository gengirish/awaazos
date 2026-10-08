import { BarChart3, Globe2, MessageCircle, Mic, QrCode, WifiOff } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const features = [
  {
    icon: Mic,
    title: "Voice Orders",
    description: "Hands-busy at the counter? Speak items and quantities — we structure the cart for you.",
  },
  {
    icon: QrCode,
    title: "UPI QR Payment",
    description: "Generate a UPI QR on every bill so customers pay instantly from any app.",
  },
  {
    icon: MessageCircle,
    title: "WhatsApp Receipts",
    description: "Send professional receipts customers can save and share — fewer disputes, faster trust.",
  },
  {
    icon: BarChart3,
    title: "Sales Analytics",
    description: "See what sells, when you peak, and how revenue trends over days and weeks.",
  },
  {
    icon: Globe2,
    title: "Multi-Language",
    description: "Speak orders in English or Hindi — tuned for how Indian vendors actually talk.",
  },
  {
    icon: WifiOff,
    title: "Works Offline*",
    description: "Keep selling when the network dips; sync when you are back online.",
    footnote: "*Coming soon",
  },
] as const;

export function Features() {
  return (
    <section aria-labelledby="features-heading" className="bg-muted/40 px-4 py-16 sm:px-6 sm:py-20">
      <div className="mx-auto max-w-6xl">
        <h2 id="features-heading" className="font-display text-3xl font-bold text-awaaz-charcoal sm:text-4xl">
          Everything you need to run the counter
        </h2>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Voice-first billing with payments and receipts — without a steep learning curve.
        </p>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => {
            const Icon = f.icon;
            return (
              <Card key={f.title} className="border-border/80 bg-background shadow-sm">
                <CardHeader className="pb-2">
                  <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-lg bg-awaaz-orange/10 text-awaaz-orange">
                    <Icon className="h-6 w-6" aria-hidden="true" />
                  </div>
                  <CardTitle className="font-display text-lg text-awaaz-charcoal">{f.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-relaxed text-muted-foreground">{f.description}</p>
                  {"footnote" in f ? (
                    <p className="mt-2 text-xs text-muted-foreground">{f.footnote}</p>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}
