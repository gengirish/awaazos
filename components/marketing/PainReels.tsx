import { PainReelCard } from "@/components/marketing/PainReelCard";
import { env } from "@/lib/env";
import { painReelsFor, type PainReelStore, type ResolvedPainReel } from "@/lib/pain-reels";

const ROWS: readonly { store: PainReelStore; label: string }[] = [
  { store: "kitchen", label: "Home kitchens" },
  { store: "jewellery", label: "Jewellery and other products" },
];

/**
 * "Sound familiar?": the problems sellers name on our survey, each as a short
 * film of the fix (lib/pain-reels.ts). One scrolling row per store type; every
 * card links to the Reel's page, so the landing page stays static and ships no
 * player. Renders nothing while PAIN_REEL_BASE_URL is unset.
 */
export function PainReels() {
  const rows = ROWS.map((row) => ({ ...row, reels: painReelsFor(row.store, env.PAIN_REEL_BASE_URL) })).filter(
    (row): row is { store: PainReelStore; label: string; reels: ResolvedPainReel[] } => row.reels.length > 0,
  );
  if (rows.length === 0) return null;

  return (
    <section id="sound-familiar" aria-labelledby="pain-reels-heading" className="bg-muted/40 px-4 py-16 sm:px-6 sm:py-20">
      <div className="mx-auto max-w-6xl">
        <h2 id="pain-reels-heading" className="font-display text-3xl font-bold text-balance text-awaaz-charcoal sm:text-4xl">
          Sound familiar?
        </h2>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          The problems sellers tell us about most, and how each one goes away. Under a minute each.
        </p>
        {rows.map((row) => (
          <div key={row.store} className="mt-10">
            <h3 className="font-display text-xl font-semibold text-awaaz-charcoal">{row.label}</h3>
            <ul className="-mx-4 mt-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-3 sm:mx-0 sm:px-0">
              {row.reels.map((reel) => (
                <li key={reel.id} className="shrink-0 snap-start">
                  <PainReelCard reel={reel} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
