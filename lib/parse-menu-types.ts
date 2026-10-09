/**
 * Voice menu builder — the draft shape returned by `POST /api/ai/parse-menu`.
 *
 * Client-safe: types only, no imports with runtime cost. The menu review UI can
 * `import type { MenuDraft } from "@/lib/parse-menu-types"`.
 *
 * Nothing in a draft is saved. The vendor reviews it and sends the rows they
 * keep to `POST /api/menu/bulk` as `{ name, priceInPaise, category, emoji,
 * aliases, existingMenuItemId }`. Money is integer paise.
 */

/**
 * - "create":       new dish, not on the menu yet.
 * - "update_price": an existing item was named with a different price.
 * - "unchanged":    an existing item was named with its current price (or no price).
 */
export type MenuDraftAction = "create" | "update_price" | "unchanged";

export type MenuDraftItem = {
  /** Stable row key, unique within the draft: "existing:<menuItemId>" or "new:<normalised name>". */
  key: string;
  /** Cleaned display name, Title Case, <= 80 chars. For an existing item this is its current menu name. */
  name: string;
  /**
   * Integer paise. > 0 whenever `priceSpoken` is true or the row is an existing
   * item (then it is the spoken price, or the current price when none was said).
   * A NEW item with no usable spoken price carries 0 — the UI must ask for the
   * price; `POST /api/menu/bulk` rejects 0.
   */
  priceInPaise: number;
  /**
   * Existing item: its current category. New item: an existing category's exact
   * spelling when the spoken/inferred one matches it case-insensitively, else the
   * spoken one, else the model's inference, else "General".
   */
  category: string;
  /** Existing item: its current emoji. New item: suggestEmoji(name) ?? "🍽️". */
  emoji: string;
  /** Existing item: its current aliases. New item: suggestAliases(name) + spoken variants. */
  aliases: string[];
  action: MenuDraftAction;
  existingMenuItemId: string | null;
  existingPriceInPaise: number | null;
  /** False when no usable price was heard (missing, zero, absurd) — the UI must ask. */
  priceSpoken: boolean;
  /** True when the existing item was found by approximate spelling — worth a second look. */
  matchedFuzzy?: boolean;
};

export type MenuDraft = {
  items: MenuDraftItem[];
  /** Plain-language things the vendor should check before saving. */
  warnings: string[];
  /** Spoken fragments that could not be turned into a dish. */
  unparsed: string[];
  model: "haiku" | "sonnet";
};
