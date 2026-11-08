import { describe, expect, it } from "vitest";

import { PROOF_STORIES, publicProofStories, type ProofStory } from "@/lib/proof-stories";

const story = (over: Partial<ProofStory>): ProofStory => ({
  storeName: "Meera's Bakes",
  category: "Home bakery",
  city: "Hyderabad",
  screenshot: null,
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

  it("drops an entry with no words or no store name", () => {
    expect(publicProofStories([story({ quote: " " }), story({ storeName: "" })])).toEqual([]);
  });

  it("ships with nothing public, so the section is hidden", () => {
    expect(publicProofStories(PROOF_STORIES)).toEqual([]);
  });
});
