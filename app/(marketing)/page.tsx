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
      <PricingTeaser />
      <CtaBanner />
    </>
  );
}
