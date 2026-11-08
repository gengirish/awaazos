import Image from "next/image";
import { Quote } from "lucide-react";

import { publicProofStories } from "@/lib/proof-stories";

/** Real stores in their owners' words (lib/proof-stories.ts). Renders nothing until one owner agrees. */
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
          {stories.map((s) => (
            <li key={s.storeName} className="flex flex-col overflow-hidden rounded-xl border border-border/80 bg-background shadow-xs">
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
              <figure className="flex flex-1 flex-col gap-3 p-5">
                <Quote className="h-5 w-5 text-awaaz-orange" aria-hidden="true" />
                <blockquote className="text-awaaz-charcoal">{s.quote}</blockquote>
                <figcaption className="mt-auto text-sm text-muted-foreground">
                  <span className="font-semibold text-awaaz-charcoal">{s.attribution}</span>, {s.storeName} · {s.category},{" "}
                  {s.city}
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
