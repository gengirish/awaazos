/**
 * Voice drop builder — the draft shape returned by `POST /api/ai/parse-drop`.
 *
 * Client-safe: types only, no imports with runtime cost. The drop form can
 * `import type { DropDraft } from "@/lib/parse-drop-types"` (or from
 * `@/lib/parse-drop`, which re-exports these).
 *
 * Field names mirror `dropUpsertSchema` (lib/zod-drops.ts) so a draft can be
 * merged straight into the form state. Every field except `items` is optional:
 * when a field is absent the form keeps whatever it already shows. Fields the
 * server defaulted (rather than heard) are present but NOT listed in `filled`.
 *
 * Money is integer paise, dates are IST "YYYY-MM-DD", times IST "HH:MM" (24h).
 */

export type DropDraftItem = {
  /** Always a real MenuItem id of the calling vendor (re-anchored server-side). */
  menuItemId: string;
  /** Menu name, for display in the review step (not sent back to the drops API). */
  name: string;
  /** Spoken override, else the menu price. Integer paise, > 0. */
  priceInPaise: number;
  /** Capacity for this drop (1..10000), or null = no limit / not said. */
  maxQty: number | null;
  /** Per-order cap (1..1000, never above maxQty), or null. */
  perOrderLimit: number | null;
  sortOrder: number;
  /** True when the id came from the server's name match, not the model — worth a second look. */
  matchedByName?: boolean;
};

export type DropDraftUnmatched = {
  spokenName: string;
  quantity?: number;
};

export type DropDraftField =
  | "title"
  | "note"
  | "date"
  | "fulfilmentMode"
  | "fulfilmentStart"
  | "fulfilmentEnd"
  | "pickupNote"
  | "deliveryFeePaise"
  | "opensAtDate"
  | "opensAtTime"
  | "closesAtDate"
  | "closesAtTime"
  | "showEverydayMenu"
  | "items";

export type DropDraft = {
  title?: string;
  note?: string;
  /** Cooking / fulfilment day (IST). */
  date?: string;
  fulfilmentMode?: "DELIVERY" | "PICKUP" | "BOTH";
  fulfilmentStart?: string;
  fulfilmentEnd?: string;
  pickupNote?: string;
  deliveryFeePaise?: number;
  opensAtDate?: string;
  opensAtTime?: string;
  closesAtDate?: string;
  closesAtTime?: string;
  showEverydayMenu?: boolean;
  items: DropDraftItem[];
  /** Spoken items that could not be tied to a menu row. */
  unmatched: DropDraftUnmatched[];
  /** Plain-language things the vendor should check before saving. */
  warnings: string[];
  /** Which fields came from the vendor's words (the rest are defaults or absent). */
  filled: DropDraftField[];
  model: "haiku" | "sonnet";
};
