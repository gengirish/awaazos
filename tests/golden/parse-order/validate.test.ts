import { describe, expect, it } from "vitest";

import {
  loadFixtures,
  loadMenu,
  validateFixtureMenuRefs,
} from "./fixtures";

/**
 * Offline golden-test sanity. Runs in every CI pass — no network, no LLM.
 *
 * Catches the most common golden-test failure modes BEFORE you waste a $0.001
 * Anthropic call on a typo:
 *   - Fixture JSON is malformed
 *   - Fixture references a menuItemId that doesn't exist
 *   - Menu has duplicate ids or malformed price
 *   - Fixture id doesn't match its filename slug pattern
 *   - Fixture lang doesn't match its directory naming
 */

describe("golden parse-order: menu integrity", () => {
  const menu = loadMenu();

  it("loads a non-empty menu", () => {
    expect(menu.length).toBeGreaterThan(0);
  });

  it("has unique menu item ids", () => {
    const ids = new Set(menu.map((m) => m.id));
    expect(ids.size).toBe(menu.length);
  });

  it("has all positive prices in paise (integer)", () => {
    for (const m of menu) {
      expect(Number.isInteger(m.priceInPaise)).toBe(true);
      expect(m.priceInPaise).toBeGreaterThan(0);
    }
  });

  it("aliases do not contain duplicates within an item", () => {
    for (const m of menu) {
      const seen = new Set<string>();
      for (const a of m.aliases) {
        const norm = a.toLowerCase().trim();
        expect(seen.has(norm), `duplicate alias "${a}" on ${m.id}`).toBe(false);
        seen.add(norm);
      }
    }
  });
});

describe("golden parse-order: fixture integrity", () => {
  const fixtures = loadFixtures();

  it("loads at least 20 fixtures (the bar for a meaningful golden set)", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(20);
  });

  it("has unique fixture ids", () => {
    const ids = new Set(fixtures.map((f) => f.id));
    expect(ids.size).toBe(fixtures.length);
  });

  it("every expected.menuItemId exists in the menu", () => {
    const errors = validateFixtureMenuRefs(fixtures, loadMenu());
    expect(errors, errors.join("\n")).toEqual([]);
  });

  it("fixture id prefix matches lang code (en-/hi-/te-/kn-/ta-)", () => {
    for (const fx of fixtures) {
      const expectedPrefix = fx.lang.slice(0, 2);
      expect(
        fx.id.startsWith(`${expectedPrefix}-`),
        `${fx.id}: id prefix doesn't match lang ${fx.lang}`,
      ).toBe(true);
    }
  });

  it("covers every supported language with at least 3 fixtures", () => {
    const counts: Record<string, number> = {};
    for (const fx of fixtures) {
      counts[fx.lang] = (counts[fx.lang] ?? 0) + 1;
    }
    for (const lang of ["en-IN", "hi-IN", "te-IN", "kn-IN", "ta-IN"]) {
      expect(counts[lang] ?? 0, `lang ${lang} under-covered`).toBeGreaterThanOrEqual(3);
    }
  });

  it("has at least one fixture per high-leverage tag", () => {
    const tags = new Set(fixtures.flatMap((f) => f.tags));
    for (const required of [
      "indic-numerals",
      "alias-resolution",
      "unmatched",
      "out-of-domain",
    ]) {
      expect(tags.has(required), `missing tag: ${required}`).toBe(true);
    }
  });
});
