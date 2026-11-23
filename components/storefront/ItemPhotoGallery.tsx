"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ItemPhoto } from "@/components/storefront/ItemPhoto";
import { cn } from "@/lib/utils";

/**
 * Several photos of one item at the top of its detail sheet
 * (docs/PRODUCT_PAGE_PLAN.md step 3): swipe on a phone (CSS scroll-snap, no
 * library), arrows for a mouse or keyboard, "2 / 5" and dots for where you are.
 * Each photo still opens full-size on a tap (`ItemPhoto enlarge`).
 *
 * Which photo is showing is read from the scroll position on each scroll
 * event: no timer, no autoplay. While an arrow's smooth scroll is on its way,
 * the in-between positions are ignored (`pending`), so a second quick tap moves
 * on from where the first was going, not from where the scroll happened to be.
 * A finger or wheel on the photos hands control back to the scroll position.
 * Picking a colour with its own photo (`focus`) turns the track to it.
 */
/** Which photo the track is showing, from its scroll position. */
function positionIn(el: HTMLDivElement, count: number): number {
  return Math.min(count - 1, Math.max(0, Math.round(el.scrollLeft / el.clientWidth)));
}

/** The track settled on photo `at`: show it, unless an arrow is still on its way elsewhere. */
function arrived(pending: { current: number | null }, setIndex: (i: number) => void, at: number) {
  if (pending.current !== null) {
    if (at !== pending.current) return;
    pending.current = null;
  }
  setIndex(at);
}

export function ItemPhotoGallery({
  photos,
  name,
  dimmed,
  focus = null,
}: {
  photos: readonly string[];
  name: string;
  dimmed?: boolean;
  /** A photo to turn to: the picked colour's (lib/item-variants.ts rule 8). Each new value moves once. */
  focus?: string | null;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  /** The photo an arrow is scrolling to; null once it arrives or the buyer takes over. */
  const pending = useRef<number | null>(null);
  const count = photos.length;

  // The buyer picked a colour with its own photo: turn to it (at once when the sheet opens).
  // Keyed on the index, not the array: the sheet builds a new `photos` on every render,
  // and a re-render must never pull the buyer's swipe back.
  const focusIndex = focus === null ? -1 : photos.indexOf(focus);
  const moved = useRef(false);
  useEffect(() => {
    const el = track.current;
    if (!el || focusIndex === -1 || el.clientWidth === 0) return;
    // The first turn (the sheet opening on a picked colour) is instant; later picks glide.
    const first = !moved.current;
    moved.current = true;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    pending.current = focusIndex === positionIn(el, count) ? null : focusIndex;
    el.scrollTo({ left: focusIndex * el.clientWidth, behavior: first || reduce ? "auto" : "smooth" });
    setIndex(focusIndex);
  }, [focusIndex, count]);

  function onScroll() {
    const el = track.current;
    if (el && el.clientWidth > 0) arrived(pending, setIndex, positionIn(el, count));
  }

  // Also on scrollend: a smooth scroll can stop between snap points' rounding halves.
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const settle = () => {
      if (el.clientWidth > 0) arrived(pending, setIndex, positionIn(el, count));
    };
    el.addEventListener("scrollend", settle);
    return () => el.removeEventListener("scrollend", settle);
  }, [count]);

  /** The buyer's finger or wheel takes over from an arrow. */
  function takeOver() {
    pending.current = null;
  }

  /** An arrow: one photo on from where the last arrow was heading, not from mid-scroll. */
  function step(dir: -1 | 1) {
    const el = track.current;
    if (!el) return;
    const from = pending.current ?? index;
    const target = Math.min(count - 1, Math.max(0, from + dir));
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    pending.current = target === positionIn(el, count) ? null : target;
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
          onPointerDown={takeOver}
          onWheel={takeOver}
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
          onClick={() => step(-1)}
          disabled={index === 0}
          aria-label="Previous photo"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={cn(arrow, "right-2")}
          onClick={() => step(1)}
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
