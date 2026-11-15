import { describe, expect, it } from "vitest";

import {
  canAddPhoto,
  COVER_ID,
  itemPhotoList,
  MAX_ITEM_PHOTOS,
  movePhoto,
  photoLayout,
  photoUrls,
  removePhoto,
  reorderPhotos,
} from "@/lib/item-photos";

const extras = [
  { id: "p2", url: "https://b/2.jpg" },
  { id: "p3", url: "https://b/3.jpg" },
];
const list = itemPhotoList("https://b/1.jpg", extras);

describe("itemPhotoList / photoUrls", () => {
  it("puts the cover first", () => {
    expect(list.map((p) => p.id)).toEqual([COVER_ID, "p2", "p3"]);
    expect(photoUrls("https://b/1.jpg", ["https://b/2.jpg"])).toEqual(["https://b/1.jpg", "https://b/2.jpg"]);
  });

  it("shows buyers nothing without a cover", () => {
    expect(photoUrls(null, ["https://b/2.jpg"])).toEqual([]);
    expect(itemPhotoList(null, extras).map((p) => p.id)).toEqual(["p2", "p3"]);
  });
});

describe("canAddPhoto", () => {
  it("allows up to MAX_ITEM_PHOTOS, cover included", () => {
    expect(canAddPhoto(MAX_ITEM_PHOTOS - 1)).toBe(true);
    expect(canAddPhoto(MAX_ITEM_PHOTOS)).toBe(false);
  });
});

describe("reorderPhotos", () => {
  it("returns the urls in the new order; the first becomes the cover", () => {
    const urls = reorderPhotos(list, ["p3", COVER_ID, "p2"]);
    expect(urls).toEqual(["https://b/3.jpg", "https://b/1.jpg", "https://b/2.jpg"]);
    expect(photoLayout(urls!).cover).toBe("https://b/3.jpg");
  });

  it("refuses an order that doesn't name every photo exactly once", () => {
    expect(reorderPhotos(list, ["p3", "p2"])).toBeNull();
    expect(reorderPhotos(list, ["p3", "p3", "p2"])).toBeNull();
    expect(reorderPhotos(list, ["p3", COVER_ID, "other"])).toBeNull();
  });
});

describe("removePhoto", () => {
  it("moves the next photo up when the cover goes", () => {
    const urls = removePhoto(list, COVER_ID);
    expect(urls).toEqual(["https://b/2.jpg", "https://b/3.jpg"]);
    expect(photoLayout(urls!)).toEqual({ cover: "https://b/2.jpg", extras: [{ url: "https://b/3.jpg", sortOrder: 0 }] });
  });

  it("is null for an id that isn't the item's", () => {
    expect(removePhoto(list, "elsewhere")).toBeNull();
  });
});

describe("movePhoto", () => {
  it("swaps with the neighbour", () => {
    expect(movePhoto(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(movePhoto(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
  });

  it("leaves the ends alone", () => {
    expect(movePhoto(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(movePhoto(["a", "b"], 1, 1)).toEqual(["a", "b"]);
  });
});

describe("photoLayout", () => {
  it("stores nothing for no photos", () => {
    expect(photoLayout([])).toEqual({ cover: null, extras: [] });
  });

  it("never keeps more than MAX_ITEM_PHOTOS", () => {
    const urls = Array.from({ length: MAX_ITEM_PHOTOS + 2 }, (_, i) => `https://b/${i}.jpg`);
    expect(photoLayout(urls).extras).toHaveLength(MAX_ITEM_PHOTOS - 1);
  });
});
