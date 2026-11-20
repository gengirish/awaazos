import { PAIN_REELS } from "@/content/pain-reels/reels";
import { helpVideosFor, type ResolvedHelpVideo } from "@/lib/help-videos";
import { OWNER_PAINS } from "@/lib/owner-survey";
import { painReelById, type ResolvedPainReel } from "@/lib/pain-reels";
import type { StoreKind } from "@/lib/store-vocabulary";

/**
 * The film the owner survey answers with, for the problem that hurts most (`topPain`).
 * Pure and client-safe. Plan: docs/PAIN_REELS_APP_PLAN.md, Phase 2.
 *
 * - Public /survey (no account): the pain-point Reels for that pain, kitchen first. The
 *   survey asks no store type, so the form shows the first and links to the other.
 * - Settings → Tell us what's hard (already a seller): the Help film for the same job.
 *   It is the film the kitchen Reel is cut from (`PainReel.film`), so the two never point
 *   at different screens, and it must be one the store's type is offered on /help.
 *
 * A pain no film shows gets nothing, and the form keeps its plain thank-you line.
 * The lookups are built per page from published files only; they carry no answers.
 */

/** Every pain's Reels, kitchen first; pains with none are left out. Empty when nothing is published. */
export function surveyReelsByPain(rawBase: string | undefined): Record<string, ResolvedPainReel[]> {
  const out: Record<string, ResolvedPainReel[]> = {};
  for (const { key } of OWNER_PAINS) {
    const reels = PAIN_REELS.filter((r) => r.pain === key)
      .sort((a, b) => Number(a.store !== "kitchen") - Number(b.store !== "kitchen"))
      .flatMap((r) => painReelById(r.id, rawBase) ?? []);
    if (reels.length > 0) out[key] = reels;
  }
  return out;
}

/** The Help film for each pain that has one this store is offered; empty when nothing is published. */
export function surveyHelpFilmByPain(kind: StoreKind, rawBase: string | undefined): Record<string, ResolvedHelpVideo> {
  const offered = new Map(helpVideosFor(kind, rawBase).list.map((v) => [v.id, v]));
  const out: Record<string, ResolvedHelpVideo> = {};
  for (const { key } of OWNER_PAINS) {
    const film = PAIN_REELS.map((r) => (r.pain === key ? offered.get(r.film) : undefined)).find(Boolean);
    if (film) out[key] = film;
  }
  return out;
}
