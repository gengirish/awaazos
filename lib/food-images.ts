/**
 * Illustrated stand-ins for items without a photo on the public store page
 * (/s/[slug]): a drawing of a cake beats a 🎂, and can't be mistaken for the
 * seller's own product the way a stock photo could. Pure and client-safe.
 *
 * - Display only. Nothing is written to `MenuItem.imageUrl`; the seller's own
 *   photo always wins, and with no match the emoji stays.
 * - Not used at the counter (POS keeps emojis: speed, and it works offline).
 * - Files are `public/food/<slug>.webp`, 320 px square, flat illustrations on
 *   the same cream background, generated for AwaazOS (no third-party licence).
 *   Adding one = drop the file in and add a rule below.
 *
 * Matching works like `suggestEmoji` (lib/menu-suggestions.ts): the item name,
 * normalised, is tested against ordered rules and the first hit wins, so
 * specific nouns sit above generic ones ("Cupcake" before "cake", "Milk Cake"
 * is a barfi). A `null` rule claims a dish we have no drawing for, so a word
 * inside it can't pick a wrong one ("Pani Puri" is not a paratha). With no
 * hit on the name, the item's category gets the same test ("Cakes").
 */

export const FOOD_IMAGE_DIR = "/food";

const FOOD_IMAGE_RULES: ReadonlyArray<readonly [slug: string | null, terms: readonly string[]]> = [
  // Dishes we have no drawing for yet: stop here rather than match a word inside them.
  [null, ["pani puri", "panipuri", "golgappa", "gol gappa", "puchka", "sev puri", "dahi puri", "bhel", "bhelpuri", "chaat", "pav bhaji", "pao bhaji", "misal", "thali", "fries"]],
  // Frozen and bakery — product nouns before flavours.
  ["ice-cream", ["ice cream", "icecream", "gelato", "sundae", "kulfi", "softy", "falooda", "faluda"]],
  ["cupcake", ["cupcake", "cup cake", "muffin"]],
  ["brownie", ["brownie", "blondie", "fudge"]],
  ["barfi", ["barfi", "burfi", "kaju katli", "katli", "milk cake", "peda", "pedha", "sandesh", "mysore pak"]],
  ["pastry", ["pastry", "pastries", "tiramisu", "cheesecake", "slice", "eclair"]],
  ["cake", ["cake", "gateau", "bento"]],
  ["cookies", ["cookie", "biscuit", "nankhatai", "macaron"]],
  ["bread", ["bread", "loaf", "bun", "sourdough", "focaccia", "brioche", "rusk", "ladi pav"]],
  // Indian sweets.
  ["laddu", ["laddu", "ladoo", "laddoo", "ladu"]],
  ["jalebi", ["jalebi", "jilebi", "imarti"]],
  ["gulab-jamun", ["gulab jamun", "kala jamun", "jamun"]],
  ["kheer", ["kheer", "payasam", "phirni", "rabri", "rabdi", "basundi"]],
  // Snacks and meals.
  ["pizza", ["pizza"]],
  ["burger", ["burger", "vada pav", "vada pao", "dabeli"]],
  ["sandwich", ["sandwich", "toast", "sub", "wrap"]],
  ["samosa", ["samosa", "kachori", "pakora", "pakoda", "bhajji", "bhajiya"]],
  ["momos", ["momo", "dumpling", "dim sum"]],
  ["dosa", ["dosa", "dosai", "uttapam", "appam", "pesarattu"]],
  ["idli", ["idli", "idly"]],
  ["paratha", ["paratha", "parantha", "parotta", "roti", "chapati", "phulka", "naan", "kulcha", "thepla", "puri", "poori"]],
  ["biryani", ["biryani", "biriyani", "pulao", "pulav", "mandi"]],
  // Drinks — "Mango Lassi" is a lassi, "Lemon Tea" a chai.
  ["lassi", ["lassi", "milkshake", "shake", "smoothie", "chaas", "chhach", "buttermilk", "thandai"]],
  ["coffee", ["coffee", "kaapi", "cappuccino", "latte", "espresso", "mocha"]],
  ["chai", ["chai", "tea", "kahwa"]],
  ["juice", ["juice", "sharbat", "sherbet", "lemonade", "nimbu pani", "shikanji", "soda", "mojito", "cooler", "jaljeera", "panna"]],
];

const FOOD_IMAGE_MATCHERS: ReadonlyArray<readonly [string | null, RegExp]> = FOOD_IMAGE_RULES.map(([slug, terms]) => [
  slug,
  new RegExp(`(?:^| )(?:${terms.join("|")})(?:e?s)?(?= |$)`),
]);

function normalise(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** `undefined` = no rule matched; `null` = a rule claimed it with no drawing. */
function matchSlug(text: string): string | null | undefined {
  const norm = normalise(text);
  if (!norm) return undefined;
  for (const [slug, re] of FOOD_IMAGE_MATCHERS) {
    if (re.test(norm)) return slug;
  }
  return undefined;
}

/**
 * The illustration for an item ("Chocolate Truffle Cake" → /food/cake.webp),
 * from its name, else its category; null when neither matches.
 */
export function foodImageFor(name: string, category?: string | null): string | null {
  const byName = matchSlug(name);
  const slug = byName !== undefined ? byName : category ? matchSlug(category) : undefined;
  return slug ? `${FOOD_IMAGE_DIR}/${slug}.webp` : null;
}

/** Every slug the rules can return, for the test that each one has a file. */
export function foodImageSlugs(): string[] {
  return Array.from(new Set(FOOD_IMAGE_RULES.map(([slug]) => slug).filter((s): s is string => s !== null)));
}
