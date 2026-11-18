/**
 * Re-file a demo store that was built before demo stores could be product stores
 * (PR #206): a jewellery seller filed as `general` reads as a kitchen and every
 * item shows the 🍽️ fallback. Pure, so `scripts/fix-demo-store-kind.ts` can print
 * the plan as a dry run and tests can pin it.
 *
 * Only items that still carry the plate (or no emoji) and have no photo are
 * re-picked: a photo hides the emoji, and an emoji the seller chose stays theirs.
 */
import { demoStallType, type DemoCategory } from "@/lib/demo-store-schema";
import { defaultEmoji } from "@/lib/menu-emoji";
import { suggestEmoji } from "@/lib/menu-suggestions";
import { storeKind, storeVocabulary } from "@/lib/store-vocabulary";
import type { StallType } from "@prisma/client";

export interface KindFixItem {
  id: string;
  name: string;
  emoji: string | null;
  imageUrl: string | null;
}

export interface KindFixPlan {
  stallType: StallType;
  stallTypeOther: string | null;
  /** Whether the store's own type changes. */
  storeChanges: boolean;
  items: { id: string; name: string; from: string | null; to: string }[];
}

/** 🍽️ with or without the variation selector. */
export function isPlateFallback(emoji: string | null): boolean {
  if (emoji === null) return true;
  const bare = emoji.replace(/️/g, "").trim();
  return bare === "" || bare === "🍽";
}

export function planDemoKindFix(
  current: { stallType: StallType; stallTypeOther: string | null },
  category: DemoCategory,
  items: readonly KindFixItem[],
): KindFixPlan {
  const { stallType, stallTypeOther } = demoStallType(category);
  const kind = storeKind(stallType);
  const fallback = defaultEmoji(storeVocabulary(stallType));
  const changes: KindFixPlan["items"] = [];
  for (const item of items) {
    if (item.imageUrl || !isPlateFallback(item.emoji)) continue;
    const to = suggestEmoji(item.name, kind) ?? fallback;
    if (to !== item.emoji) changes.push({ id: item.id, name: item.name, from: item.emoji, to });
  }
  return {
    stallType,
    stallTypeOther,
    storeChanges: current.stallType !== stallType || current.stallTypeOther !== stallTypeOther,
    items: changes,
  };
}
