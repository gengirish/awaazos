import { CtaBanner } from "@/components/marketing/CtaBanner";
import { Features } from "@/components/marketing/Features";
import { Hero } from "@/components/marketing/Hero";
import { HowItWorks } from "@/components/marketing/HowItWorks";
import { PricingTeaser } from "@/components/marketing/PricingTeaser";

export default function MarketingHomePage() {
  return (
    <>
      <Hero />
      <HowItWorks />
      <Features />
      <section aria-labelledby="social-proof-heading" className="px-4 py-10 sm:px-6">
        <div className="mx-auto max-w-6xl rounded-2xl border border-border/60 bg-awaaz-cream/40 px-6 py-8 text-center sm:px-10">
          <h2
            id="social-proof-heading"
            className="font-display text-lg font-semibold text-awaaz-charcoal sm:text-xl"
          >
            Trusted by vendors at 50+ events across Hyderabad
          </h2>
        </div>
      </section>
      <PricingTeaser />
      <CtaBanner />
    </>
  );
}
