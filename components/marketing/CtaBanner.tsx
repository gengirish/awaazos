import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PLAN_MARKETING } from "@/lib/plan-copy";

export function CtaBanner() {
  return (
    <section aria-labelledby="cta-heading" className="bg-awaaz-orange px-4 py-14 sm:px-6 sm:py-16">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 text-center sm:flex-row sm:justify-between sm:text-left">
        <div>
          <h2 id="cta-heading" className="font-display text-2xl font-bold text-balance text-white sm:text-3xl">
            Run your next drop on AwaazOS
          </h2>
          <p className="mt-2 max-w-xl text-white/90">
            Set up your store, share the link, and stop tracking orders in DMs and WhatsApp chats. {PLAN_MARKETING.STARTER.ctaNote}
          </p>
        </div>
        <Button
          asChild
          size="lg"
          variant="secondary"
          className="min-h-12 w-full shrink-0 bg-white sm:w-auto px-8 text-base font-semibold text-awaaz-orange shadow-md hover:bg-white/90 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-awaaz-orange"
        >
          <Link href="/sign-up">{PLAN_MARKETING.STARTER.cta}</Link>
        </Button>
      </div>
    </section>
  );
}
