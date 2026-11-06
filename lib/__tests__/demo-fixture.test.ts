import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildDemoFixture, DEMO_FIXTURE_CATEGORIES, fixtureMenuItems, fixtureSlug } from "@/lib/demo-fixture";
import { fixtureDropTimes } from "@/lib/demo-fixture-server";
import { istToUtc } from "@/lib/drops-time";
import { parseMenuSlots } from "@/lib/menu-slots";
import { storeHandleProblem } from "@/lib/store-handle";
import { isValidStoreTagline } from "@/lib/store-tagline";
import { STORE_THEMES } from "@/lib/store-theme";

describe.each(DEMO_FIXTURE_CATEGORIES)("demo fixture: %s", (category) => {
  const f = buildDemoFixture({ category, city: "Hyderabad" });

  it("has a clean name, link and tagline", () => {
    expect(storeHandleProblem(f.slug)).toBeNull();
    expect(isValidStoreTagline(f.tagline)).toBe(true);
    expect(f.tagline).toContain("Hyderabad");
    expect(f.tagline).not.toMatch(/ from Hyderabad$/);
    expect((STORE_THEMES as readonly string[]).includes(f.theme)).toBe(true);
  });

  it("has 4–6 everyday items, none named like a test row", () => {
    expect(f.everyday.length).toBeGreaterThanOrEqual(4);
    expect(f.everyday.length).toBeLessThanOrEqual(6);
    for (const i of fixtureMenuItems(f)) {
      expect(i.name).not.toMatch(/test|with image/i);
      expect(i.rupees).toBeGreaterThan(0);
    }
  });

  it("every picture is a file in /public", () => {
    for (const i of fixtureMenuItems(f)) {
      expect(fs.existsSync(path.join(process.cwd(), "public", i.imageUrl))).toBe(true);
    }
  });

  it("one drop with 3–4 items, one of them down to 3", () => {
    expect(f.drop.items.length).toBeGreaterThanOrEqual(3);
    expect(f.drop.items.length).toBeLessThanOrEqual(4);
    expect(f.drop.items.some((i) => i.maxQty === 3)).toBe(true);
  });

  it("the free item costs less than every item that earns it", () => {
    for (const i of f.everyday) expect(f.gift.rupees).toBeLessThan(i.rupees);
    expect(f.offer.minQty).toBe(2);
  });

  it("has slots checkout can offer", () => {
    expect(parseMenuSlots(f.slots)).toEqual(f.slots);
  });

  it("puts the cut-off about two days out, before the handover", () => {
    const now = istToUtc("2026-11-06", "10:00");
    const t = fixtureDropTimes(f, now);
    const hours = (t.closesAt.getTime() - now.getTime()) / 3_600_000;
    expect(hours).toBeGreaterThan(24);
    expect(hours).toBeLessThan(48);
    expect(t.closesAt.getTime()).toBeLessThan(t.fulfilmentStartsAt.getTime());
    expect(t.fulfilmentStartsAt.getTime()).toBeLessThan(t.fulfilmentEndsAt.getTime());
  });
});

describe("fixtureSlug", () => {
  it("drops apostrophes and spells out &", () => {
    expect(fixtureSlug("Meera's Bakehouse")).toBe("meeras-bakehouse");
    expect(fixtureSlug("Tulsi & Thyme")).toBe("tulsi-and-thyme");
  });

  it("takes the name the caller gives", () => {
    expect(buildDemoFixture({ category: "meals", city: "Pune", name: "Sunita's Tiffins" }).slug).toBe("sunitas-tiffins");
  });
});
