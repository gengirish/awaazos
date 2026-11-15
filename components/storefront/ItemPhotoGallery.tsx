"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRef, useState } from "react";

import { ItemPhoto } from "@/components/storefront/ItemPhoto";
import { cn } from "@/lib/utils";

/**
 * Several photos of one item at the top of its detail sheet
 * (docs/PRODUCT_PAGE_PLAN.md step 3): swipe on a phone (CSS scroll-snap, no
 * library), arrows for a mouse or keyboard, "2 / 5" and dots for where you are.
 * Each photo still opens full-size on a tap (`ItemPhoto enlarge`).
 *
 * Which photo is showing is read from the scroll position on each scroll
 * event: no timer, no autoplay.
 */
export function ItemPhotoGallery({ photos, name, dimmed }: { photos: readonly string[]; name: string; dimmed?: boolean }) {
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const count = photos.length;

  function onScroll() {
    const el = track.current;
    if (!el || el.clientWidth === 0) return;
    const at = Math.min(count - 1, Math.max(0, Math.round(el.scrollLeft / el.clientWidth)));
    if (at !== index) setIndex(at);
  }

  function go(to: number) {
    const el = track.current;
    if (!el) return;
    const target = Math.min(count - 1, Math.max(0, to));
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: target * el.clientWidth, behavior: reduce ? "auto" : "smooth" });
    setIndex(target);
  }

  const arrow =
    "absolute top-1/2 flex min-h-11 min-w-11 -translate-y-1/2 items-center justify-center rounded-full bg-background/90 text-foreground shadow ring-1 ring-border/60 transition-opacity disabled:pointer-events-none disabled:opacity-0 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <section aria-label={`Photos of ${name}`} className="space-y-2">
      <div className="relative">
        <div
          ref={track}
          onScroll={onScroll}
          className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain rounded-2xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          data-testid="item-photo-track"
        >
          {photos.map((src, i) => (
            <div
              key={`${i}-${src}`}
              role="group"
              aria-label={`Photo ${i + 1} of ${count}`}
              className="w-full shrink-0 snap-center"
            >
              <ItemPhoto
                src={src}
                emoji=""
                name={name}
                size="hero"
                enlarge
                dimmed={dimmed}
                label={`See photo ${i + 1} of ${count} of ${name}`}
              />
            </div>
          ))}
        </div>
        <button
          type="button"
          className={cn(arrow, "left-2")}
          onClick={() => go(index - 1)}
          disabled={index === 0}
          aria-label="Previous photo"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={cn(arrow, "right-2")}
          onClick={() => go(index + 1)}
          disabled={index === count - 1}
          aria-label="Next photo"
        >
          <ChevronRight className="h-5 w-5" aria-hidden="true" />
        </button>
        <span className="absolute bottom-2 right-2 rounded-full bg-background/90 px-2 py-0.5 text-xs font-semibold text-foreground ring-1 ring-border/60">
          <span className="sr-only">Showing photo </span>
          {index + 1} / {count}
        </span>
      </div>
      <div className="flex justify-center gap-1.5" aria-hidden="true">
        {photos.map((src, i) => (
          <span
            key={`${i}-${src}`}
            className={cn("h-1.5 rounded-full transition-all", i === index ? "w-4 bg-primary" : "w-1.5 bg-muted-foreground/40")}
          />
        ))}
      </div>
    </section>
  );
}
