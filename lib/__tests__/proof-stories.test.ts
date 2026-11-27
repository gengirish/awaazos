import { describe, expect, it } from "vitest";

import { PROOF_STORIES, proofStoreHref, publicProofStories, type ProofStory } from "@/lib/proof-stories";

const story = (over: Partial<ProofStory>): ProofStory => ({
  storeName: "Meera's Bakes",
  category: "Home bakery",
  city: "Hyderabad",
  storeSlug: null,
  screenshot: null,
  summary: "Cakes and cookies to order.",
  quote: "Orders stopped getting lost in my DMs.",
  attribution: "Meera, owner",
  permission: true,
  ...over,
});

describe("publicProofStories", () => {
  it("shows only stories whose owner gave permission", () => {
    expect(publicProofStories([story({}), story({ storeName: "B", permission: false })]).map((s) => s.storeName)).toEqual([
      "Meera's Bakes",
    ]);
  });

  it("drops an entry with no store name, or with neither words nor a live store", () => {
    expect(publicProofStories([story({ quote: " " }), story({ storeName: "" })])).toEqual([]);
  });

  it("shows a live store with permission even without a quote", () => {
    expect(publicProofStories([story({ quote: "", storeSlug: "meeras-bakes" })]).map((s) => s.storeName)).toEqual([
      "Meera's Bakes",
    ]);
  });

  it("ships the real stores as live examples, each with a link, a short summary and the owner's words", () => {
    const shown = publicProofStories(PROOF_STORIES);
    expect(shown.map((s) => s.storeName)).toEqual([
      "Pravarha Holistic Services",
      "House of Kaara",
      "Annie's Bakes & Kitchen",
    ]);
    for (const s of shown) {
      expect(s.storeSlug).toMatch(/^[a-z0-9-]{3,40}$/);
      expect(s.summary.trim()).not.toBe("");
      expect(s.summary.length).toBeLessThan(140);
      expect(s.city.trim()).not.toBe("");
      expect(s.quote.trim()).not.toBe("");
      expect(s.quote.length).toBeLessThan(200);
      expect(s.quote).not.toBe(s.summary);
    }
    expect(new Set(shown.map((s) => s.storeSlug)).size).toBe(shown.length);
  });
});

describe("proofStoreHref", () => {
  it("links to the store page, or nothing", () => {
    expect(proofStoreHref({ storeSlug: "pravarha-holistic-services" })).toBe("/s/pravarha-holistic-services");
    expect(proofStoreHref({ storeSlug: null })).toBeNull();
  });
});
