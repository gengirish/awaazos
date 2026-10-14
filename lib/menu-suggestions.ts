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

/**
 * Keyword → emoji, checked top to bottom; the first group with a whole-word hit
 * wins. Order is the point: specific product nouns ("candy", "kulfi", "lassi")
 * sit above the flavours that often prefix them ("mango", "lemon"), so
 * "Mango Candy" is a 🍬 and "Lemon Tea" a ☕. Generic words ("sweet", "milk"
 * in "Milk Cake") only win when nothing more specific matched.
 *
 * Terms are lowercase ASCII, Hindi/Hinglish transliterations included; a
 * trailing "s"/"es" plural is accepted automatically.
 */
const EMOJI_RULES: ReadonlyArray<readonly [emoji: string, terms: readonly string[]]> = [
  // Confectionery and frozen — product nouns that beat any flavour word.
  ["🍭", ["lollipop", "lolly", "lollies"]],
  ["🍬", ["candy", "candies", "toffee", "eclair", "gummy", "gummies", "chikki"]],
  ["🍧", ["gola", "ice gola", "chuski", "baraf gola"]],
  ["🍦", ["kulfi", "softy", "softie", "cone"]],
  ["🍨", ["ice cream", "icecream", "gelato", "sundae", "falooda", "faluda"]],
  ["🍿", ["popcorn"]],
  ["🍟", ["fries", "french fry", "finger chips"]],
  // Dishes with an unambiguous emoji.
  ["🍕", ["pizza"]],
  ["🍔", ["burger", "vada pav", "vada pao", "dabeli"]],
  ["🥪", ["sandwich", "sandwiches"]],
  ["🧁", ["cupcake", "muffin"]],
  ["🍰", ["pastry", "pastries", "brownie", "tiramisu", "cheesecake", "milk cake"]],
  ["🎂", ["cake"]],
  ["🍪", ["cookie", "biscuit", "nankhatai"]],
  ["🍮", ["kheer", "halwa", "payasam", "rabri", "rabdi", "phirni"]],
  ["🍬", ["laddu", "ladoo", "laddoo", "barfi", "burfi", "jalebi", "imarti", "peda", "pedha", "gulab jamun", "rasgulla", "rasmalai", "ras malai", "kaju katli", "sandesh", "mysore pak"]],
  // Drinks — before fruit, so "Mango Lassi" is a 🥛 and "Lemon Soda" a 🥤.
  ["🍋", ["lemonade", "shikanji", "shikanjvi", "nimbu pani", "nimboo pani", "lemon water"]],
  ["🥭", ["panna", "aam panna", "aam ka panna"]],
  ["☕", ["chai", "tea", "coffee", "kaapi", "kapi", "cappuccino", "latte", "espresso"]],
  ["🥛", ["lassi", "milk", "milkshake", "shake", "doodh", "chaas", "chaach", "chhach", "buttermilk", "thandai"]],
  ["🧃", ["juice", "ras", "nariyal pani", "coconut water"]],
  ["🥤", ["sharbat", "sharabat", "sherbet", "sarbat", "sharbath", "soda", "cola", "mojito", "cooler", "jaljeera", "jal jeera", "rooh afza", "soft drink"]],
  // Street snacks and meals.
  ["🍛", ["pav bhaji", "pao bhaji", "misal", "misal pav"]],
  ["🥗", ["bhel", "bhelpuri", "chaat", "chat", "salad", "pani puri", "panipuri", "golgappa", "gol gappa", "puchka", "phuchka", "sev puri", "dahi puri", "papdi", "ragda"]],
  ["🥟", ["samosa", "pakora", "pakoda", "bhajji", "bhajiya", "vada", "wada", "kachori", "momo", "dumpling", "bonda", "cutlet"]],
  ["🫓", ["dosa", "dosai", "idli", "uttapam", "appam", "paratha", "parantha", "parotta", "roti", "naan", "kulcha", "chapati", "thepla", "puri", "poori", "bhatura"]],
  ["🍝", ["pasta", "spaghetti", "macaroni"]],
  ["🍜", ["noodles", "noodle", "maggi", "chowmein", "chow mein", "hakka", "ramen", "thukpa"]],
  ["🍛", ["biryani", "biriyani", "pulao", "pulav", "rice", "khichdi", "thali", "curry", "paneer", "dal", "daal", "chole", "chana", "rajma", "sabzi", "sabji", "korma", "kadhi"]],
  ["🍗", ["chicken", "murgh", "wings", "drumstick"]],
  ["🥚", ["egg", "anda", "omelette", "omelet", "bhurji"]],
  ["🌽", ["corn", "bhutta", "makai", "makka"]],
  // Flavours — only when no product noun matched.
  ["🥭", ["mango", "aam"]],
  ["🍋", ["lemon", "nimbu", "nimboo", "lime"]],
  ["🍫", ["chocolate", "choco"]],
  // Generic last resort.
  ["🍬", ["sweet", "sweets", "mithai"]],
];

const EMOJI_MATCHERS: ReadonlyArray<readonly [string, RegExp]> = EMOJI_RULES.map(([emoji, terms]) => [
  emoji,
  new RegExp(`(?:^| )(?:${terms.join("|")})(?:e?s)?(?= |$)`),
]);

/**
 * Suggest a menu emoji from an item name, or null when nothing matches.
 * "Aam Ka Panna" → 🥭, "Lemonade Candy" → 🍬, "Lays Bhel" → 🥗.
 *
 * Only a suggestion for a NEW item's picker — an existing item's emoji is
 * vendor-chosen data and is never rewritten from this.
 */
export function suggestEmoji(name: string): string | null {
  const norm = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!norm) return null;
  for (const [emoji, re] of EMOJI_MATCHERS) {
    if (re.test(norm)) return emoji;
  }
  return null;
}
