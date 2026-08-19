/**
 * Slug generation and alias suggestion for menu items.
 *
 * generateSlug    → URL/log-safe string from a display name
 * deduplicateSlug → append -2/-3 suffix if the base slug is taken
 * suggestAliases  → derive voice-match aliases from a name automatically
 */

const SLUG_STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "of", "with", "in", "on", "at",
]);

const ALIAS_STOP_WORDS = new Set([
  ...Array.from(SLUG_STOP_WORDS),
  "sweet", "fresh", "special", "extra", "mini", "small", "large", "big",
  "hot", "cold", "spicy", "plain",
]);

/**
 * Convert a display name to a URL/log-safe slug.
 * "Mohabbatein Sharbat" → "mohabbatein-sharbat"
 * "Masala Chai ☕"       → "masala-chai"
 */
export function generateSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")   // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")     // emoji, punctuation → space
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

/**
 * Ensure a slug is unique within the vendor's existing slugs.
 * Appends -2, -3, … until a free slot is found.
 */
export function deduplicateSlug(base: string, existing: Set<string>): string {
  if (!existing.has(base)) return base;
  let n = 2;
  while (existing.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/**
 * Derive voice-match aliases from an item name.
 * These are merged with manually entered aliases at create time.
 *
 * "Mohabbatein Sharbat" → ["mohabbatein sharbat", "sharbat", "mohabbatein"]
 * "Sweet Lassi"         → ["sweet lassi", "lassi"]
 * "Masala Dosa"         → ["masala dosa", "dosa", "masala"]
 * "Bhel Puri"           → ["bhel puri", "bhel", "puri"]
 */
export function suggestAliases(name: string): string[] {
  const norm = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .trim()
    .replace(/\s+/g, " ");

  const words = norm.split(" ").filter((w) => w.length >= 2);
  const suggestions = new Set<string>();

  // Full normalized name
  suggestions.add(norm);

  // Each significant word individually (min 3 chars to avoid noise)
  for (const w of words) {
    if (w.length >= 3 && !ALIAS_STOP_WORDS.has(w)) suggestions.add(w);
  }

  // Name with leading/trailing stop words stripped
  const significant = words.filter((w) => !ALIAS_STOP_WORDS.has(w)).join(" ");
  if (significant && significant !== norm) suggestions.add(significant);

  return Array.from(suggestions);
}
