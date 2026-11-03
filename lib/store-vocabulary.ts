import type { StallType } from "@prisma/client";

/**
 * The words the app uses for a store's catalogue, keyed on what it sells
 * (`Vendor.stallType`). Pure and client-safe.
 *
 * AwaazOS started with home kitchens, so a food store keeps the kitchen words
 * ("Menu", "dish", "Prep sheet"). Any other store (a wellness seller, a
 * boutique, a kirana, "Other: Pickles & podis") gets neutral ones ("Products",
 * "product", "Packing list"). The neutral words are never wrong for food, only
 * less warm, so anything not clearly food falls on that side.
 *
 * `GENERAL` is the sign-up default and the type most existing kitchens still
 * carry, so it stays on the kitchen words: changing what "General" stores see
 * would rename the tab under every one of them.
 *
 * Wording only. Routes (`/menu`), models (`MenuItem`), API fields and stored
 * settings (`acceptMenuOrders`) keep their names whatever the store sells.
 */

export type StoreKind = "food" | "goods";

const FOOD_STALL_TYPES: ReadonlySet<StallType> = new Set<StallType>([
  "GENERAL",
  "FOOD_BEVERAGE",
  "STREET_FOOD",
  "CARNIVAL",
  "SCHOOL_CANTEEN",
  "HOME_BAKERY",
  "HOME_KITCHEN",
  "CLOUD_KITCHEN",
  "CAFE",
  "SWEETS",
  "CATERING",
]);

export function storeKind(stallType: StallType | null | undefined): StoreKind {
  return stallType == null || FOOD_STALL_TYPES.has(stallType) ? "food" : "goods";
}

export type StoreVocabulary = {
  kind: StoreKind;
  /** Nav tab and page title: "Menu" / "Products". */
  catalogueTitle: string;
  /** Mid-sentence, after "your" / "the": "menu" / "product list". */
  catalogue: string;
  /** One catalogue row, lower case: "dish" / "product". */
  item: string;
  /** "dishes" / "products". */
  items: string;
  /** Sentence-start forms: "Dish" / "Product". */
  Item: string;
  /** "Dishes" / "Products". */
  Items: string;
  /** The everyday-orders setting and its board source: "Order from menu" / "Order any time". */
  catalogueOrdersTitle: string;
  /** Board source and filter for those orders: "Menu orders" / "Everyday orders". */
  catalogueOrders: string;
  /** One of them: "Menu order" / "Everyday order". */
  catalogueOrder: string;
  /** The per-drop print sheet: "Prep sheet" / "Packing list". */
  prepSheet: string;
  /** Its quantities line on the board: "To cook" / "To pack". */
  toPrepare: string;
  /** The day a drop is made: "Cooking day" / "Packing day". */
  makeDay: string;
  /** "before you start cooking" / "before you start packing". */
  making: string;
  /** What reaches the buyer: "food" / "order" ("when the food arrives"). */
  goods: string;
  /** Placeholder drop name. */
  dropExample: string;
  /** What the drop list's empty state suggests: "tomorrow's cooking" / "your next batch". */
  nextBatch: string;
  /** Show the dish drawings (lib/food-images.ts) and offer food emoji. */
  foodArt: boolean;
  /** Example text in the checkout's note field. */
  orderNoteExample: string;
};

const FOOD: StoreVocabulary = {
  kind: "food",
  catalogueTitle: "Menu",
  catalogue: "menu",
  item: "dish",
  items: "dishes",
  Item: "Dish",
  Items: "Dishes",
  catalogueOrdersTitle: "Order from menu",
  catalogueOrders: "Menu orders",
  catalogueOrder: "Menu order",
  prepSheet: "Prep sheet",
  toPrepare: "To cook",
  makeDay: "Cooking day",
  making: "cooking",
  goods: "food",
  dropExample: "Saturday bakes",
  nextBatch: "tomorrow's cooking",
  foodArt: true,
  orderNoteExample: "eggless, less spicy…",
};

const GOODS: StoreVocabulary = {
  kind: "goods",
  catalogueTitle: "Products",
  catalogue: "product list",
  item: "product",
  items: "products",
  Item: "Product",
  Items: "Products",
  catalogueOrdersTitle: "Order any time",
  catalogueOrders: "Everyday orders",
  catalogueOrder: "Everyday order",
  prepSheet: "Packing list",
  toPrepare: "To pack",
  makeDay: "Packing day",
  making: "packing",
  goods: "order",
  dropExample: "Festive gift boxes",
  nextBatch: "your next batch",
  foodArt: false,
  orderNoteExample: "gift wrap, call before delivery…",
};

export function storeVocabulary(stallType: StallType | null | undefined): StoreVocabulary {
  return storeKind(stallType) === "food" ? FOOD : GOODS;
}

/** The vocabulary of a kind, for client code that was handed only `StoreKind`. */
export function vocabularyForKind(kind: StoreKind): StoreVocabulary {
  return kind === "food" ? FOOD : GOODS;
}

type VocabularyWord = Exclude<keyof StoreVocabulary, "kind" | "foodArt" | "orderNoteExample">;

/**
 * Fill `{word}` tokens in fixed copy (lib/help-guide.ts, the setup checklist):
 * "Add your first {item}" → "Add your first dish" / "Add your first product".
 * Unknown tokens are left as written so a typo shows up on screen and in tests.
 */
export function fillVocabulary(text: string, vocab: StoreVocabulary): string {
  return text.replace(/\{(\w+)\}/g, (whole, key: string) => {
    if (key === "kind" || key === "foodArt" || key === "orderNoteExample" || !(key in vocab)) return whole;
    return vocab[key as VocabularyWord];
  });
}

/** "1 dish" / "3 products". */
export function countItems(vocab: StoreVocabulary, n: number): string {
  return `${n} ${n === 1 ? vocab.item : vocab.items}`;
}
