/**
 * Item search, shared by the public store page (/s/[slug]), the POS quick-add
 * grid and the seller's Menu screen (/menu). Pure and client-safe: each screen
 * already holds every item it shows, so search filters in the browser — no
 * request, no database read.
 *
 * Matching is forgiving on purpose (buyers type on phones, in Hinglish):
 * case, accents and punctuation are ignored, and every word typed must appear
 * somewhere in the item's text ("choc cake" finds "Chocolate Truffle Cake").
 *
 * An item's text is built by `itemSearchText` everywhere, so a server-rendered
 * row and a client list agree on what matches. Aliases (voice spellings) go in
 * on staff screens only; the public store sends its index to every visitor and
 * keeps to what its rows already show. Tags never go in (raw tags stay on the
 * server).
 */

/** Lower-case, accents stripped, anything but letters/digits → single spaces. */
export function normaliseSearchText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** The query's words, normalised; empty when there is nothing to search for. */
export function searchTerms(query: string): string[] {
  const q = normaliseSearchText(query);
  return q ? q.split(" ") : [];
}

/** Every term appears in `text`. No terms matches everything. */
export function matchesSearch(text: string, terms: readonly string[]): boolean {
  if (terms.length === 0) return true;
  const haystack = normaliseSearchText(text);
  return terms.every((t) => haystack.includes(t));
}

export type SearchableItem = {
  name: string;
  description?: string | null;
  /** Voice spellings ("bhel" for "Bhel Puri"): staff screens only. */
  aliases?: readonly string[] | null;
};

/**
 * The text a search matches for one item: its name, description and aliases,
 * then `context` (its category, or the drop's title).
 */
export function itemSearchText(item: SearchableItem, ...context: (string | null | undefined)[]): string {
  return [item.name, item.description, ...(item.aliases ?? []), ...context].filter(Boolean).join(" ");
}

/** Staff screens (POS quick add, /menu) show a search field above this many items. */
export const STAFF_SEARCH_MIN_ITEMS = 15;
