import type { StallType } from "@prisma/client";

import { PAIN_REELS, type PainReel } from "@/content/pain-reels/reels";
import { HELP_VIDEOS, helpVideoBase } from "@/lib/help-videos";
import { storeKind } from "@/lib/store-vocabulary";

/**
 * The pain-point Reels (content/pain-reels/reels.ts) as the app shows them: the
 * landing page's "Sound familiar?" row and each Reel's own page, /v/<id>.
 * Pure and client-safe, like lib/help-videos.ts. Plan: docs/PAIN_REELS_APP_PLAN.md.
 *
 * Files: `npm run pain-reels:publish` puts `<id>.mp4` and `<id>.jpg` (the hook
 * card as poster) in one public folder, named by PAIN_REEL_BASE_URL. Unset base →
 * no row and every /v page 404s, so nothing points at a missing file.
 *
 * These sell the product to sellers. Buyers never see them.
 */

/** Which store a Reel was filmed in, which is also the row it sits in. */
export type PainReelStore = PainReel["store"];

export type ResolvedPainReel = Pick<PainReel, "id" | "store" | "hook" | "sub" | "title" | "seconds"> & {
  /** What the film says, for the transcript under the player. */
  lines: readonly string[];
  src: string;
  poster: string;
};

/** The voice-over: the Reel's own lines, else those of the Help film it reuses. */
export function painReelLines(reel: PainReel): readonly string[] {
  return reel.lines ?? HELP_VIDEOS.find((v) => v.id === reel.film)?.lines ?? [];
}

function resolve(reel: PainReel, base: string): ResolvedPainReel {
  return {
    id: reel.id,
    store: reel.store,
    hook: reel.hook,
    sub: reel.sub,
    title: reel.title,
    seconds: reel.seconds,
    lines: painReelLines(reel),
    src: `${base}/${reel.id}.mp4`,
    poster: `${base}/${reel.id}.jpg`,
  };
}

/** One Reel by id, or null when the id is unknown or nothing is published. */
export function painReelById(id: string, rawBase: string | undefined): ResolvedPainReel | null {
  const base = helpVideoBase(rawBase);
  const reel = PAIN_REELS.find((r) => r.id === id);
  return base && reel ? resolve(reel, base) : null;
}

/** Every Reel filmed in this store, in PAIN_REELS order; empty when nothing is published. */
export function painReelsFor(store: PainReelStore, rawBase: string | undefined): ResolvedPainReel[] {
  const base = helpVideoBase(rawBase);
  if (!base) return [];
  return PAIN_REELS.filter((r) => r.store === store).map((r) => resolve(r, base));
}

/** Every id, for the /v pages built at deploy time. */
export function painReelIds(): string[] {
  return PAIN_REELS.map((r) => r.id);
}

/** Path of a Reel's own page. */
export function painReelPath(id: string): string {
  return `/v/${id}`;
}

/**
 * The Reels row for a store type: a food store gets the kitchen Reels, a clothing
 * store the clothing ones, any other the jewellery ones (the landing page's
 * "Jewellery and other products" row).
 */
export function painReelStoreFor(stallType: StallType | null | undefined): PainReelStore {
  if (storeKind(stallType) === "food") return "kitchen";
  return stallType === "CLOTHING" ? "clothing" : "jewellery";
}

/** Every row, the given one first: the order the outreach Reel picker lists them in. */
export function painReelRowsFirst(store: PainReelStore): PainReelStore[] {
  return [store, ...PAIN_REEL_STORES.filter((s) => s !== store)];
}

/** The row most of these stores are in (ties go to the earlier row); kitchen for none. */
export function mostCommonReelStore(stores: readonly { reelStore: PainReelStore }[]): PainReelStore {
  let best: PainReelStore = "kitchen";
  let bestCount = 0;
  for (const row of PAIN_REEL_STORES) {
    const count = stores.filter((s) => s.reelStore === row).length;
    if (count > bestCount) [best, bestCount] = [row, count];
  }
  return best;
}

/** The rows, in landing-page order. */
export const PAIN_REEL_STORES: readonly PainReelStore[] = ["kitchen", "jewellery", "clothing"];

/** A Reel as a message links to it: its page on the site, never the file. */
export type PainReelLink = Pick<PainReel, "id" | "store" | "title"> & { url: string };

/**
 * Every Reel's page link on `origin` (no trailing slash), for the outreach messages on
 * /admin/demo-stores; empty when nothing is published, because the pages then 404.
 */
export function painReelLinks(rawBase: string | undefined, origin: string): PainReelLink[] {
  if (!helpVideoBase(rawBase)) return [];
  return PAIN_REELS.map((r) => ({ id: r.id, store: r.store, title: r.title, url: `${origin}${painReelPath(r.id)}` }));
}
