/**
 * The starter emoji grids for menu items, shared by the item form and the voice
 * menu builder. Its own module so the voice panel doesn't pull in the form,
 * which /menu loads only when it opens (docs/PERFORMANCE.md).
 */

import type { StoreVocabulary } from "@/lib/store-vocabulary";

/** Starter emoji grid, shared with the voice menu builder's review rows. */
export const FOOD_EMOJIS = [
  "🍽️",
  "🥘",
  "🍛",
  "🍜",
  "🍲",
  "🥗",
  "🥪",
  "🌯",
  "🌮",
  "🥙",
  "🍕",
  "🍔",
  "🌭",
  "🥨",
  "🥐",
  "🍞",
  "🥖",
  "🧀",
  "🍳",
  "🥞",
] as const;

/** The starter grid for a store that doesn't sell food (lib/store-vocabulary.ts). */
export const GOODS_EMOJIS = [
  "🛍️",
  "📦",
  "🎁",
  "🌿",
  "🍃",
  "🌸",
  "🫙",
  "🍯",
  "🫖",
  "🧴",
  "🧼",
  "💊",
  "🕯️",
  "🪔",
  "🧘",
  "💆",
  "👕",
  "👜",
  "💍",
  "✨",
] as const;

export const DEFAULT_EMOJI = "🍽️";
const DEFAULT_GOODS_EMOJI = "🛍️";

/** The emoji grid this store is offered. */
export function emojiChoices(vocab: StoreVocabulary): readonly string[] {
  return vocab.foodArt ? FOOD_EMOJIS : GOODS_EMOJIS;
}

/** The emoji a new row gets when nothing suggests one. */
export function defaultEmoji(vocab: StoreVocabulary): string {
  return vocab.foodArt ? DEFAULT_EMOJI : DEFAULT_GOODS_EMOJI;
}
