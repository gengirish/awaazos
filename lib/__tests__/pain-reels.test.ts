import { describe, expect, it } from "vitest";

import { PAIN_REELS } from "@/content/pain-reels/reels";
import { OWNER_PAINS } from "@/lib/owner-survey";
import {
  painReelById,
  painReelIds,
  painReelLines,
  painReelLinks,
  painReelPath,
  painReelsFor,
  painReelStoreFor,
} from "@/lib/pain-reels";

const BASE = "https://store.example/pain-reels";

describe("PAIN_REELS data", () => {
  it("has unique ids that are safe in a URL path", () => {
    const ids = PAIN_REELS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9_-]+$/);
  });

  it("answers only real survey pains", () => {
    const keys = new Set<string>(OWNER_PAINS.map((p) => p.key));
    for (const reel of PAIN_REELS) if (reel.pain !== null) expect(keys.has(reel.pain), reel.id).toBe(true);
  });

  it("gives every Reel a title, a length and a transcript", () => {
    for (const reel of PAIN_REELS) {
      expect(reel.title.trim(), reel.id).not.toBe("");
      expect(reel.seconds, reel.id).toBeGreaterThan(0);
      expect(painReelLines(reel).length, `${reel.id} needs lines, or a Help film`).toBeGreaterThan(0);
    }
  });
});

describe("painReelById", () => {
  it("resolves the files under the published folder", () => {
    const reel = painReelById("orders_scattered", `${BASE}/`);
    expect(reel?.src).toBe(`${BASE}/orders_scattered.mp4`);
    expect(reel?.poster).toBe(`${BASE}/orders_scattered.jpg`);
  });

  it("reuses the Help film's transcript when the Reel has none of its own", () => {
    // orders_scattered plays c1-buyer-order, a Help film.
    expect(painReelById("orders_scattered", BASE)?.lines[0]).toBe("Your buyer taps the link in your Instagram bio.");
  });

  it("is null for an unknown id, and for every id when nothing is published", () => {
    expect(painReelById("nope", BASE)).toBeNull();
    expect(painReelById("orders_scattered", undefined)).toBeNull();
    expect(painReelById("orders_scattered", "  ")).toBeNull();
    expect(painReelById("orders_scattered", "javascript:alert(1)")).toBeNull();
  });
});

describe("painReelsFor", () => {
  it("splits the Reels by the store they were filmed in", () => {
    const kitchen = painReelsFor("kitchen", BASE);
    const jewellery = painReelsFor("jewellery", BASE);
    expect(kitchen.length + jewellery.length).toBe(PAIN_REELS.length);
    expect(kitchen.every((r) => r.store === "kitchen")).toBe(true);
    expect(jewellery.every((r) => r.store === "jewellery")).toBe(true);
  });

  it("is empty when nothing is published", () => {
    expect(painReelsFor("kitchen", undefined)).toEqual([]);
  });
});

it("lists every id for the static /v pages", () => {
  expect(painReelIds()).toEqual(PAIN_REELS.map((r) => r.id));
  expect(painReelPath("delivery")).toBe("/v/delivery");
});

describe("painReelLinks", () => {
  it("links every Reel's page on the site, not the file", () => {
    const links = painReelLinks(BASE, "https://awaazdo.store");
    expect(links).toHaveLength(PAIN_REELS.length);
    expect(links[0]).toEqual({
      id: PAIN_REELS[0]!.id,
      store: PAIN_REELS[0]!.store,
      title: PAIN_REELS[0]!.title,
      url: `https://awaazdo.store/v/${PAIN_REELS[0]!.id}`,
    });
  });

  it("is empty when nothing is published, because the pages 404 then", () => {
    expect(painReelLinks(undefined, "https://awaazdo.store")).toEqual([]);
  });

  it("gives food stores the kitchen row and every other store the jewellery row", () => {
    expect(painReelStoreFor("food")).toBe("kitchen");
    expect(painReelStoreFor("goods")).toBe("jewellery");
  });
});
