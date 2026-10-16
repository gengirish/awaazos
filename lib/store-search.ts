/**
 * Item search on the public store page (/s/[slug]). Pure and client-safe: the
 * page already holds every item it shows, so search filters in the browser —
 * no request, no database read.
 *
 * Matching is forgiving on purpose (buyers type on phones, in Hinglish):
 * case, accents and punctuation are ignored, and every word typed must appear
 * somewhere in the item's text ("choc cake" finds "Chocolate Truffle Cake").
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
