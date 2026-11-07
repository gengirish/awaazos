/**
 * A clean demo store for outreach: the spec, by category. Pure; the database
 * side is lib/demo-fixture-server.ts and the CLI is scripts/seed-demo-store.ts.
 *
 * What a fixture store has, so a demo reads like a real seller's page:
 * - a real-sounding name, a one-line tagline and a store link made from the name;
 * - 4–6 everyday items with pictures and sensible prices (no "test" anywhere);
 * - one open drop, cut-off about two days out, 3–4 items, one with only 3 left;
 * - one tidy plan: "2+ items → free <small item>", the free item priced below
 *   every item that qualifies;
 * - weekly pickup / delivery slots, so checkout asks "when".
 *
 * Pictures are files in /public: the dish drawings in /food for food stores,
 * the /demo drawings for wellness and crafts. Nothing is uploaded.
 */
import type { MenuSlotRule } from "@/lib/menu-slots";
import { normaliseStoreHandle } from "@/lib/store-handle";

export const DEMO_FIXTURE_CATEGORIES = ["bakery", "meals", "wellness", "crafts"] as const;
export type DemoFixtureCategory = (typeof DEMO_FIXTURE_CATEGORIES)[number];

export type DemoFixtureItem = {
  name: string;
  rupees: number;
  category: string;
  description: string;
  emoji: string;
  imageUrl: string;
  unit?: string;
};

export type DemoFixtureDropItem = DemoFixtureItem & {
  /** Stock for the batch; null = no limit. */
  maxQty: number | null;
};

export type DemoFixture = {
  name: string;
  slug: string;
  city: string;
  stallType: "HOME_BAKERY" | "HOME_KITCHEN" | "OTHER";
  /** Shown as the store type when stallType is OTHER. */
  stallTypeOther: string | null;
  tagline: string;
  theme: string;
  fulfilment: "PICKUP" | "DELIVERY" | "BOTH";
  deliveryFeePaise: number;
  pickupNote: string;
  everyday: DemoFixtureItem[];
  /** The free item of the plan: an everyday item, cheaper than everything that qualifies. */
  gift: DemoFixtureItem;
  drop: {
    title: string;
    note: string;
    /** Days from today (IST) to the handover day; the cut-off is the evening before. */
    daysAhead: number;
    cutoffTime: string;
    windowStart: string;
    windowEnd: string;
    items: DemoFixtureDropItem[];
  };
  offer: { name: string; description: string; minQty: number };
  slots: MenuSlotRule[];
};

const food = (slug: string) => `/food/${slug}.webp`;
const art = (slug: string) => `/demo/${slug}.svg`;

type Preset = Omit<DemoFixture, "name" | "slug" | "city" | "tagline"> & {
  defaultName: string;
  tagline: (city: string) => string;
};

const PRESETS: Record<DemoFixtureCategory, Preset> = {
  bakery: {
    defaultName: "Meera's Bakehouse",
    tagline: (city) => `Small-batch sourdough and bakes, made to order in ${city}`,
    stallType: "HOME_BAKERY",
    stallTypeOther: null,
    theme: "amber",
    fulfilment: "BOTH",
    deliveryFeePaise: 4000,
    pickupNote: "Collect from the gate, we'll message when it's ready.",
    everyday: [
      { name: "Classic Sourdough Loaf", rupees: 320, category: "Breads", description: "48-hour ferment, crackly crust. About 700 g.", emoji: "🍞", imageUrl: food("bread") },
      { name: "Chocolate Walnut Brownies", rupees: 280, category: "Bakes", description: "Box of 4, fudgy middles.", emoji: "🍫", imageUrl: food("brownie") },
      { name: "Butter Cookies", rupees: 220, category: "Bakes", description: "250 g tin, made with real butter.", emoji: "🍪", imageUrl: food("cookies") },
      { name: "Vanilla Bean Cupcakes", rupees: 260, category: "Bakes", description: "Box of 4 with whipped cream frosting.", emoji: "🧁", imageUrl: food("cupcake") },
    ],
    gift: { name: "Masala Chai", rupees: 40, category: "Drinks", description: "One cup, fresh with every order.", emoji: "☕", imageUrl: food("chai") },
    drop: {
      title: "This Week's Bakes",
      note: "A small batch, baked fresh the morning of pickup.",
      daysAhead: 2,
      cutoffTime: "21:00",
      windowStart: "10:00",
      windowEnd: "13:00",
      items: [
        { name: "Chocolate Truffle Cake", rupees: 650, category: "Specials", description: "500 g, dark chocolate ganache.", emoji: "🎂", imageUrl: food("cake"), maxQty: 3 },
        { name: "Cinnamon Rolls", rupees: 300, category: "Specials", description: "Box of 4 with cream cheese glaze.", emoji: "🥐", imageUrl: food("pastry"), maxQty: 12 },
        { name: "Garlic Herb Focaccia", rupees: 250, category: "Specials", description: "Olive oil, rosemary, roasted garlic.", emoji: "🍞", imageUrl: food("bread"), maxQty: 10 },
      ],
    },
    offer: { name: "Chai on us", description: "Order any 2 bakes and get a Masala Chai free.", minQty: 2 },
    slots: [
      { days: [2, 3, 4, 5, 6], start: "11:00", end: "13:00" },
      { days: [2, 3, 4, 5, 6], start: "17:00", end: "20:00" },
    ],
  },
  meals: {
    defaultName: "Amma's Kitchen",
    tagline: (city) => `Home-style lunch and dinner, cooked fresh every day in ${city}`,
    stallType: "HOME_KITCHEN",
    stallTypeOther: null,
    theme: "green",
    fulfilment: "BOTH",
    deliveryFeePaise: 3000,
    pickupNote: "Pick up from the main gate.",
    everyday: [
      { name: "Veg Thali", rupees: 180, category: "Meals", description: "2 rotis, rice, dal, sabzi, curd and pickle.", emoji: "🍛", imageUrl: food("thali") },
      { name: "Chicken Curry with Rice", rupees: 240, category: "Meals", description: "Home-style curry, serves one.", emoji: "🍗", imageUrl: food("curry") },
      { name: "Aloo Paratha", rupees: 120, category: "Meals", description: "Two parathas with curd and pickle.", emoji: "🫓", imageUrl: food("paratha") },
      { name: "Veg Biryani", rupees: 200, category: "Meals", description: "Dum-cooked with raita.", emoji: "🍚", imageUrl: food("biryani") },
      { name: "Idli Sambar", rupees: 100, category: "Breakfast", description: "Four idlis with sambar and chutney.", emoji: "🥣", imageUrl: food("idli") },
    ],
    gift: { name: "Sweet Lassi", rupees: 50, category: "Drinks", description: "Thick and chilled, 250 ml.", emoji: "🥛", imageUrl: food("lassi") },
    drop: {
      title: "Biryani Special",
      note: "Slow-cooked in small batches. Order by the night before.",
      daysAhead: 2,
      cutoffTime: "21:00",
      windowStart: "12:30",
      windowEnd: "14:30",
      items: [
        { name: "Hyderabadi Chicken Dum Biryani", rupees: 320, category: "Special", description: "Serves one, with salan and raita.", emoji: "🍗", imageUrl: food("biryani"), maxQty: 3 },
        { name: "Paneer Tikka Biryani", rupees: 280, category: "Special", description: "Serves one, with raita.", emoji: "🍚", imageUrl: food("biryani"), maxQty: 15 },
        { name: "Double Ka Meetha", rupees: 120, category: "Special", description: "Bread pudding with saffron and nuts.", emoji: "🍮", imageUrl: food("kheer"), maxQty: 20 },
      ],
    },
    offer: { name: "Lassi on us", description: "Order any 2 meals and get a Sweet Lassi free.", minQty: 2 },
    slots: [
      { days: [1, 2, 3, 4, 5, 6], start: "12:30", end: "14:30" },
      { days: [1, 2, 3, 4, 5, 6], start: "19:30", end: "21:30" },
    ],
  },
  wellness: {
    defaultName: "Tulsi & Thyme",
    tagline: (city) => `Herbal teas and natural care, blended by hand in ${city}`,
    stallType: "OTHER",
    stallTypeOther: "Herbal teas & wellness",
    theme: "green",
    fulfilment: "BOTH",
    deliveryFeePaise: 5000,
    pickupNote: "Pick up from the reception desk.",
    everyday: [
      { name: "Tulsi Green Tea", rupees: 350, category: "Herbal teas", description: "100 g loose leaf, about 40 cups.", emoji: "🍵", imageUrl: art("tea-jar") },
      { name: "Hibiscus Rose Tea", rupees: 380, category: "Herbal teas", description: "100 g, caffeine-free, bright and tangy.", emoji: "🌺", imageUrl: art("tea-cup") },
      { name: "Wild Forest Honey", rupees: 450, category: "Pantry", description: "500 g, raw and unfiltered.", emoji: "🍯", imageUrl: art("honey") },
      { name: "Neem Turmeric Soap", rupees: 180, category: "Body care", description: "Cold-process bar, 100 g.", emoji: "🧼", imageUrl: art("soap") },
    ],
    gift: { name: "Lemongrass Tea Sampler", rupees: 90, category: "Herbal teas", description: "20 g, enough for 8 cups.", emoji: "🍃", imageUrl: art("tea-cup") },
    drop: {
      title: "Winter Wellness Box",
      note: "A small seasonal batch, packed fresh this week.",
      daysAhead: 2,
      cutoffTime: "21:00",
      windowStart: "11:00",
      windowEnd: "18:00",
      items: [
        { name: "Kadha Immunity Blend", rupees: 420, category: "Seasonal", description: "100 g: ginger, tulsi, pepper, cinnamon.", emoji: "🍵", imageUrl: art("tea-jar"), maxQty: 3 },
        { name: "Saffron Kesar Honey", rupees: 650, category: "Seasonal", description: "250 g, infused for two weeks.", emoji: "🍯", imageUrl: art("honey"), maxQty: 10 },
        { name: "Winter Wellness Gift Box", rupees: 1200, category: "Seasonal", description: "Two teas, honey and a soap, gift wrapped.", emoji: "🎁", imageUrl: art("gift-box"), maxQty: 8 },
      ],
    },
    offer: { name: "Free tea sampler", description: "Order any 2 products and get a Lemongrass Tea Sampler free.", minQty: 2 },
    slots: [{ days: [1, 2, 3, 4, 5, 6], start: "11:00", end: "18:00" }],
  },
  crafts: {
    defaultName: "Little Flame Studio",
    tagline: (city) => `Hand-poured soy candles and gifts, made by hand in ${city}`,
    stallType: "OTHER",
    stallTypeOther: "Candles & crafts",
    theme: "purple",
    fulfilment: "BOTH",
    deliveryFeePaise: 6000,
    pickupNote: "Pick up from the studio, ring the bell.",
    everyday: [
      { name: "Lavender Soy Candle", rupees: 450, category: "Candles", description: "200 g jar, about 40 hours.", emoji: "🕯️", imageUrl: art("candle-jar") },
      { name: "Sandalwood Pillar Candle", rupees: 380, category: "Candles", description: "Unscented base, sandalwood top note.", emoji: "🕯️", imageUrl: art("candle-pillar") },
      { name: "Hand-painted Clay Diyas", rupees: 300, category: "Decor", description: "Set of 6, each one different.", emoji: "🪔", imageUrl: art("diya") },
      { name: "Evil Eye Beaded Bracelet", rupees: 250, category: "Jewellery", description: "Adjustable, glass beads.", emoji: "🧿", imageUrl: art("bracelet") },
    ],
    gift: { name: "Mini Tealight Candle", rupees: 60, category: "Candles", description: "One scented tealight.", emoji: "🕯️", imageUrl: art("candle-jar") },
    drop: {
      title: "Festive Gift Collection",
      note: "Limited festive pieces. Gift wrapping included.",
      daysAhead: 2,
      cutoffTime: "21:00",
      windowStart: "11:00",
      windowEnd: "19:00",
      items: [
        { name: "Festive Candle Hamper", rupees: 1500, category: "Festive", description: "Three candles, six diyas, gift box.", emoji: "🎁", imageUrl: art("gift-box"), maxQty: 3 },
        { name: "Rose & Oud Candle", rupees: 550, category: "Festive", description: "250 g amber jar.", emoji: "🕯️", imageUrl: art("candle-jar"), maxQty: 12 },
        { name: "Brass-finish Diya Set", rupees: 650, category: "Festive", description: "Set of 4, hand-painted.", emoji: "🪔", imageUrl: art("diya"), maxQty: 10 },
      ],
    },
    offer: { name: "Free tealight", description: "Order any 2 pieces and get a Mini Tealight Candle free.", minQty: 2 },
    slots: [{ days: [1, 2, 3, 4, 5, 6], start: "11:00", end: "19:00" }],
  },
};

/** "Meera's Bakehouse" → "meeras-bakehouse": the store-link rules (lib/store-handle.ts), apostrophes dropped. */
export function fixtureSlug(name: string): string {
  return normaliseStoreHandle(name.replace(/['’]/g, "").replace(/&/g, " and "));
}

export function isDemoFixtureCategory(v: string): v is DemoFixtureCategory {
  return (DEMO_FIXTURE_CATEGORIES as readonly string[]).includes(v);
}

/** The whole store for one category, with the name and city filled in. */
export function buildDemoFixture(opts: { category: DemoFixtureCategory; name?: string; city: string }): DemoFixture {
  const preset = PRESETS[opts.category];
  const name = opts.name?.trim() || preset.defaultName;
  const city = opts.city.trim();
  const { defaultName, tagline, ...rest } = preset;
  void defaultName;
  return { ...rest, name, slug: fixtureSlug(name), city, tagline: tagline(city) };
}

/** Every item the store needs as a MenuItem: everyday ones, the gift, and the drop's specials. */
export function fixtureMenuItems(f: DemoFixture): (DemoFixtureItem & { showOnline: boolean })[] {
  return [
    ...f.everyday.map((i) => ({ ...i, showOnline: true })),
    { ...f.gift, showOnline: true },
    // Drop specials are sold through the drop only, not the everyday list.
    ...f.drop.items.map((d) => ({
      name: d.name,
      rupees: d.rupees,
      category: d.category,
      description: d.description,
      emoji: d.emoji,
      imageUrl: d.imageUrl,
      showOnline: false,
    })),
  ];
}
