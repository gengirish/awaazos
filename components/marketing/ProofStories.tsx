import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, Quote } from "lucide-react";

import { proofStoreHref, publicProofStories } from "@/lib/proof-stories";

/** Real stores (lib/proof-stories.ts): our line about each, the owner's words when they sent some, and a link to the live store. Renders nothing until one owner agrees. */
export function ProofStories() {
  const stories = publicProofStories();
  if (stories.length === 0) return null;
  return (
    <section aria-labelledby="proof-heading" className="px-4 py-16 sm:px-6 sm:py-20">
      <div className="mx-auto max-w-6xl">
        <h2 id="proof-heading" className="font-display text-3xl font-bold text-balance text-awaaz-charcoal sm:text-4xl">
          Sellers already using it
        </h2>
        <ul className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {stories.map((s) => {
            const href = proofStoreHref(s);
            const place = [s.category, s.city].filter((part) => part.trim() !== "").join(", ");
            return (
              <li
                key={s.storeName}
                className="flex flex-col overflow-hidden rounded-xl border border-border/80 bg-background shadow-xs"
              >
                {s.screenshot ? (
                  <div className="relative aspect-[3/4] bg-muted">
                    <Image
                      src={s.screenshot}
                      alt={`${s.storeName}'s store page`}
                      fill
                      sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"
                      className="object-cover object-top"
                    />
                  </div>
                ) : null}
                <div className="flex flex-1 flex-col gap-3 p-5">
                  <div>
                    <p className="font-display text-lg font-bold text-awaaz-charcoal">{s.storeName}</p>
                    {place ? <p className="text-sm text-muted-foreground">{place}</p> : null}
                  </div>
                  {s.summary.trim() !== "" ? <p className="text-awaaz-charcoal">{s.summary}</p> : null}
                  {s.quote.trim() !== "" ? (
                    <figure className="flex gap-2 border-l-2 border-awaaz-orange pl-3">
                      <Quote className="mt-1 h-4 w-4 shrink-0 text-awaaz-orange" aria-hidden="true" />
                      <div>
                        <blockquote className="text-awaaz-charcoal">{s.quote}</blockquote>
                        <figcaption className="mt-1 text-sm font-semibold text-muted-foreground">{s.attribution}</figcaption>
                      </div>
                    </figure>
                  ) : null}
                  {href ? (
                    <Link
                      href={href}
                      className="mt-auto inline-flex min-h-11 items-center gap-1.5 self-start rounded-md text-sm font-semibold text-awaaz-orange underline-offset-4 outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-awaaz-orange focus-visible:ring-offset-2"
                    >
                      See their store<span className="sr-only">: {s.storeName}</span>
                      <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
