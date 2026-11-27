/**
 * Real stores, for the landing page's proof section
 * (components/marketing/ProofStories.tsx). Pure, client-safe.
 *
 * An entry shows only with `permission: true`, set once the owner has agreed to
 * their store name, city, link, screenshot and words being on our site. It needs
 * the owner's words or a link to their live store (or both): a live store alone is
 * a fair example, a name alone is not. With no such entry the section doesn't
 * render at all. Screenshots live in public/proof/ (PNG/WebP, about 600×1200).
 *
 * Two kinds of text, never mixed up:
 * - `summary` is ours: a plain description of what the store sells and how buyers
 *   order, true to its public page. Never shown in quote marks or under the owner's name.
 * - `quote` is the owner's own words, sent by them (or a wording they approved), or "".
 *   Never invent or paraphrase it.
 */
export type ProofStory = {
  storeName: string;
  /** "Home bakery", "Herbal teas", "Candles and crafts". */
  category: string;
  city: string;
  /** `Vendor.slug` of their live store (linked as /s/<slug>), or null. The store must stay published. */
  storeSlug: string | null;
  /** Path under public/, e.g. "/proof/meeras-bakes.webp", or null for a story without a picture. */
  screenshot: string | null;
  /** Our one-line description of the store, from its public page, under 140 characters. */
  summary: string;
  /** The owner's own words, under 200 characters, or "" until they send them. */
  quote: string;
  /** Who said it: "Meera, owner". */
  attribution: string;
  /** The owner agreed to all of the above being public. */
  permission: boolean;
};

export const PROOF_STORIES: readonly ProofStory[] = [
  {
    storeName: "Pravarha Holistic Services",
    category: "Holistic wellness",
    city: "Hyderabad",
    storeSlug: "pravarha-holistic-services",
    screenshot: null,
    summary: "Crystals, malas, bracelets and vastu items, with free delivery and payment online or on delivery.",
    quote: "",
    attribution: "Owner",
    permission: true,
  },
  {
    storeName: "House of Kaara",
    category: "Clothing",
    city: "Hyderabad",
    storeSlug: "house-of-kaara",
    screenshot: null,
    summary: "Handloom cotton dresses and kids' frocks, picked by size, for pickup or delivery, paid by UPI or on delivery.",
    quote: "",
    attribution: "Owner",
    permission: true,
  },
  {
    storeName: "Annie's Bakes & Kitchen",
    category: "Home bakery",
    city: "Bangalore",
    storeSlug: "annies-bakes-and-kitchen",
    screenshot: null,
    summary: "Takes pre-orders for each day's bakes, from mini pizzas to milk bread, with a cut-off before every batch.",
    quote: "",
    attribution: "Owner",
    permission: true,
  },
];

/** The stores' public page. */
export function proofStoreHref(story: Pick<ProofStory, "storeSlug">): string | null {
  return story.storeSlug ? `/s/${story.storeSlug}` : null;
}

/** The stories that may be shown: only those with permission, and with words or a live store. */
export function publicProofStories(stories: readonly ProofStory[] = PROOF_STORIES): ProofStory[] {
  return stories.filter(
    (s) => s.permission === true && s.storeName.trim() !== "" && (s.quote.trim() !== "" || s.storeSlug !== null),
  );
}
