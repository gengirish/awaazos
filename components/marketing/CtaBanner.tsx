import Link from "next/link";
import { Button } from "@/components/ui/button";

export function CtaBanner() {
  return (
    <section aria-labelledby="cta-heading" className="bg-awaaz-orange px-4 py-14 sm:px-6 sm:py-16">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 text-center sm:flex-row sm:justify-between sm:text-left">
        <div>
          <h2 id="cta-heading" className="font-display text-2xl font-bold text-white sm:text-3xl">
            Start billing in 60 seconds
          </h2>
          <p className="mt-2 max-w-xl text-white/90">
            Join vendors who are moving from notebooks to voice-first bills — free to try, no card needed.
          </p>
        </div>
        <Button
          asChild
          size="lg"
          variant="secondary"
          className="min-h-12 min-w-[44px] shrink-0 bg-white px-8 text-base font-semibold text-awaaz-orange shadow-md hover:bg-white/90 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-awaaz-orange"
        >
          <Link href="/sign-up">Sign up free</Link>
        </Button>
      </div>
    </section>
  );
}
