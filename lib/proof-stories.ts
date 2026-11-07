/**
 * Real stores and what their owners said, for the landing page's proof section
 * (components/marketing/ProofStories.tsx). Pure, client-safe.
 *
 * An entry shows only with `permission: true`, set once the owner has agreed in
 * writing to their store name, city, screenshot and words being on our site.
 * With no such entry the section doesn't render at all, so these placeholders
 * ship hidden. Screenshots live in public/proof/ (PNG/WebP, about 600×1200).
 */
export type ProofStory = {
  storeName: string;
  /** "Home bakery", "Herbal teas", "Candles and crafts". */
  category: string;
  city: string;
  /** Path under public/, e.g. "/proof/meeras-bakes.webp", or null for a quote without a picture. */
  screenshot: string | null;
  /** The owner's own words, under 200 characters. */
  quote: string;
  /** Who said it: "Meera, owner". */
  attribution: string;
  /** The owner agreed to all of the above being public. */
  permission: boolean;
};

export const PROOF_STORIES: readonly ProofStory[] = [
  {
    storeName: "Placeholder bakery",
    category: "Home bakery",
    city: "Hyderabad",
    screenshot: null,
    quote: "Placeholder: replace with the owner's words once they agree.",
    attribution: "Owner",
    permission: false,
  },
];

/** The stories that may be shown: only those with permission. */
export function publicProofStories(stories: readonly ProofStory[] = PROOF_STORIES): ProofStory[] {
  return stories.filter((s) => s.permission === true && s.quote.trim() !== "" && s.storeName.trim() !== "");
}
