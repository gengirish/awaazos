import { ChevronDown } from "lucide-react";

import { MARKETING_FAQ } from "@/lib/marketing-faq";

/**
 * Seller questions (lib/marketing-faq.ts) as native <details>: no client JS, so the
 * landing page's bundle and its static (marketing) layout are untouched.
 */
export function Faq({ className }: { className?: string }) {
  return (
    <section aria-labelledby="faq-heading" className={className ?? "bg-muted/40 px-4 py-16 sm:px-6 sm:py-20"}>
      <div className="mx-auto max-w-3xl">
        <h2 id="faq-heading" className="font-display text-3xl font-bold text-balance text-awaaz-charcoal sm:text-4xl">
          Questions sellers ask
        </h2>
        <div className="mt-8 divide-y divide-border rounded-xl border border-border/80 bg-background">
          {MARKETING_FAQ.map((item) => (
            <details key={item.question} className="group px-5">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 py-4 font-semibold text-awaaz-charcoal outline-hidden focus-visible:ring-2 focus-visible:ring-awaaz-orange focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
                {item.question}
                <ChevronDown
                  className="h-5 w-5 shrink-0 text-muted-foreground motion-safe:transition-transform group-open:rotate-180"
                  aria-hidden="true"
                />
              </summary>
              <p className="pb-4 leading-relaxed text-muted-foreground">{item.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
