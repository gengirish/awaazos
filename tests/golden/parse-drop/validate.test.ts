import { describe, expect, it } from "vitest";

import { loadFixtures, loadMenu, validateFixtures } from "./fixtures";

/**
 * Offline golden voice-drop sanity: runs in CI, no network, no LLM.
 * `npm run test:golden:drop:validate`
 */

describe("golden parse-drop: menu integrity", () => {
  const menu = loadMenu();

  it("loads a non-empty menu with unique ids and integer-paise prices", () => {
    expect(menu.length).toBeGreaterThan(0);
    expect(new Set(menu.map((m) => m.id)).size).toBe(menu.length);
    for (const m of menu) {
      expect(Number.isInteger(m.priceInPaise), m.id).toBe(true);
      expect(m.priceInPaise).toBeGreaterThan(0);
    }
  });

  it("has no duplicate aliases within an item", () => {
    for (const m of menu) {
      const norm = m.aliases.map((a) => a.toLowerCase().trim());
      expect(new Set(norm).size, m.id).toBe(norm.length);
    }
  });
});

describe("golden parse-drop: fixture integrity", () => {
  const fixtures = loadFixtures();

  it("has at least 10 fixtures with unique ids", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(10);
    expect(new Set(fixtures.map((f) => f.id)).size).toBe(fixtures.length);
  });

  it("references real menu items and is internally consistent", () => {
    const errors = validateFixtures(fixtures, loadMenu());
    expect(errors, errors.join("\n")).toEqual([]);
  });

  it("fixture id prefix matches lang", () => {
    for (const fx of fixtures) {
      expect(fx.id.startsWith(`${fx.lang.slice(0, 2)}-`), fx.id).toBe(true);
    }
  });

  it("covers the high-leverage cases", () => {
    const tags = new Set(fixtures.flatMap((f) => f.tags));
    for (const t of ["indic-numerals", "price-override", "unmatched", "weekday", "part-of-day", "defaults"]) {
      expect(tags.has(t), `missing tag: ${t}`).toBe(true);
    }
  });
});
