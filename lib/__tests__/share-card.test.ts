import { describe, expect, it } from "vitest";

import {
  dropShareCardPath,
  productShareCardPath,
  shareCardMetadata,
  shareCardVersion,
  storeShareCardPath,
} from "@/lib/share-card";

describe("share card", () => {
  it("version changes with what the card draws and is stable otherwise", () => {
    const a = shareCardVersion({ items: [["Samosa", 2000]] });
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(shareCardVersion({ items: [["Samosa", 2000]] })).toBe(a);
    expect(shareCardVersion({ items: [["Samosa", 2500]] })).not.toBe(a);
  });

  it("paths carry the version and encode the slug and item id", () => {
    expect(storeShareCardPath("asha")).toBe("/s/asha/share-card");
    expect(storeShareCardPath("asha", "abc")).toBe("/s/asha/share-card?v=abc");
    expect(productShareCardPath("asha", "it 1", "abc")).toBe("/s/asha/p/it%201/share-card?v=abc");
    expect(dropShareCardPath("asha", "d 1", "abc")).toBe("/s/asha/preorder/d%201/share-card?v=abc");
    expect(dropShareCardPath("asha", "d1")).toBe("/s/asha/preorder/d1/share-card");
  });

  it("sets the same image for Open Graph and X", () => {
    const m = shareCardMetadata("/s/asha/share-card?v=abc", { title: "Asha" });
    const og = m.openGraph as { images: { url: string; width: number }[]; title: string };
    expect(og.title).toBe("Asha");
    expect(og.images[0]).toMatchObject({ url: "/s/asha/share-card?v=abc", width: 1200 });
    expect((m.twitter as { images: { url: string }[] }).images[0]!.url).toBe("/s/asha/share-card?v=abc");
  });
});
