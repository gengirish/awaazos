import { describe, expect, it } from "vitest";

import {
  communityCreateSchema,
  communitySlugSchema,
  communityStoreOrdering,
  sortCommunityStores,
  storeSlugFromInput,
  type CommunityStoreInput,
} from "@/lib/community";

const NOW = new Date("2026-10-21T08:00:00Z");
const at = (h: number) => new Date(NOW.getTime() + h * 60 * 60 * 1000);

const store = (over: Partial<CommunityStoreInput> = {}): CommunityStoreInput => ({
  slug: "s",
  name: "S",
  acceptMenuOrders: false,
  drops: [],
  ...over,
});

const drop = (title: string, closesInH: number, opensInH: number | null = null, status = "OPEN") => ({
  title,
  status,
  opensAt: opensInH === null ? null : at(opensInH),
  closesAt: at(closesInH),
});

describe("communityStoreOrdering", () => {
  it("picks the open drop with the soonest cut-off", () => {
    const o = communityStoreOrdering(store({ drops: [drop("Later", 10), drop("Sooner", 3)] }), NOW);
    expect(o).toEqual({ kind: "drop_open", title: "Sooner", closesAt: at(3) });
  });

  it("ignores drops past their cut-off and drops not stored OPEN", () => {
    const o = communityStoreOrdering(
      store({ acceptMenuOrders: true, drops: [drop("Gone", -1), drop("Draft", 5, null, "DRAFT")] }),
      NOW,
    );
    expect(o).toEqual({ kind: "menu" });
  });

  it("shows a drop that opens later as scheduled", () => {
    const o = communityStoreOrdering(store({ drops: [drop("Saturday bakes", 30, 6)] }), NOW);
    expect(o).toEqual({ kind: "drop_scheduled", title: "Saturday bakes", opensAt: at(6) });
  });

  it("prefers a drop open now over one opening later", () => {
    const o = communityStoreOrdering(store({ drops: [drop("Later", 30, 1), drop("Now", 40, -1)] }), NOW);
    expect(o.kind).toBe("drop_open");
  });

  it("falls back to browse when nothing is orderable", () => {
    expect(communityStoreOrdering(store(), NOW)).toEqual({ kind: "browse" });
  });
});

describe("sortCommunityStores", () => {
  it("orders open drops, scheduled, menu, browse; then by time and name", () => {
    const rows = [
      { name: "browse-b", ordering: { kind: "browse" as const } },
      { name: "menu", ordering: { kind: "menu" as const } },
      { name: "browse-a", ordering: { kind: "browse" as const } },
      { name: "sched", ordering: { kind: "drop_scheduled" as const, title: "x", opensAt: at(2) } },
      { name: "open-late", ordering: { kind: "drop_open" as const, title: "x", closesAt: at(9) } },
      { name: "open-soon", ordering: { kind: "drop_open" as const, title: "x", closesAt: at(1) } },
    ];
    expect(sortCommunityStores(rows).map((r) => r.name)).toEqual([
      "open-soon",
      "open-late",
      "sched",
      "menu",
      "browse-a",
      "browse-b",
    ]);
  });
});

describe("storeSlugFromInput", () => {
  it.each([
    ["ravis-bhel", "ravis-bhel"],
    ["  Ravis-Bhel ", "ravis-bhel"],
    ["/s/ravis-bhel", "ravis-bhel"],
    ["https://awaazos.intelliforge.tech/s/ravis-bhel?utm=ig", "ravis-bhel"],
    ["awaazos.intelliforge.tech/s/ravis-bhel/o/abc", "ravis-bhel"],
  ])("%s → %s", (raw, slug) => {
    expect(storeSlugFromInput(raw)).toBe(slug);
  });
});

describe("community schemas", () => {
  it("uses the store-link rules for the slug", () => {
    expect(communitySlugSchema.safeParse("sdg-home-kitchens").success).toBe(true);
    expect(communitySlugSchema.safeParse("ab").success).toBe(false);
    expect(communitySlugSchema.safeParse("SDG Kitchens").success).toBe(false);
    expect(communitySlugSchema.safeParse("admin").success).toBe(false);
  });

  it("turns blank optional text into null", () => {
    const parsed = communityCreateSchema.parse({ slug: "sdg", name: "SDG Home Kitchens", area: "  ", description: "" });
    expect(parsed.area).toBeNull();
    expect(parsed.description).toBeNull();
  });
});
