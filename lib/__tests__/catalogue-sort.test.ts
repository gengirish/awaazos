import { describe, expect, it } from "vitest";

import {
  catalogueSortStorageKey,
  parseCatalogueSort,
  showsCatalogueSort,
  sortCatalogue,
  type SortKey,
} from "@/lib/catalogue-sort";

type Row = { id: string } & SortKey;
const rows: Row[] = [
  { id: "a", pricePaise: 300, createdAtMs: 1 },
  { id: "b", pricePaise: 100, createdAtMs: 3 },
  { id: "c", pricePaise: 300, createdAtMs: 2 },
  { id: "d", pricePaise: 200, createdAtMs: 3 },
];
const ids = (list: Row[]) => list.map((r) => r.id);
const key = (r: Row) => r;

describe("sortCatalogue", () => {
  it("keeps the seller's order for 'ours'", () => {
    expect(ids(sortCatalogue(rows, "ours", key))).toEqual(["a", "b", "c", "d"]);
  });

  it("sorts by price both ways, ties in the seller's order", () => {
    expect(ids(sortCatalogue(rows, "price_asc", key))).toEqual(["b", "d", "a", "c"]);
    expect(ids(sortCatalogue(rows, "price_desc", key))).toEqual(["a", "c", "d", "b"]);
  });

  it("puts the newest first, ties in the seller's order", () => {
    expect(ids(sortCatalogue(rows, "newest", key))).toEqual(["b", "d", "c", "a"]);
  });

  it("never mutates its input", () => {
    const copy = [...rows];
    sortCatalogue(rows, "price_asc", key);
    expect(rows).toEqual(copy);
  });
});

describe("showsCatalogueSort", () => {
  it("shows from 13 items, never at 12", () => {
    expect(showsCatalogueSort(12)).toBe(false);
    expect(showsCatalogueSort(13)).toBe(true);
  });
});

describe("parseCatalogueSort", () => {
  it("reads known values and falls back to 'ours'", () => {
    expect(parseCatalogueSort("price_desc")).toBe("price_desc");
    expect(parseCatalogueSort("newest")).toBe("newest");
    expect(parseCatalogueSort("popular")).toBe("ours");
    expect(parseCatalogueSort(null)).toBe("ours");
    expect(parseCatalogueSort(undefined)).toBe("ours");
  });

  it("keys the stored pick by store", () => {
    expect(catalogueSortStorageKey("sam-store")).toBe("awz_sort:sam-store");
  });
});
