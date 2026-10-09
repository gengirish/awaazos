import { describe, expect, it, vi } from "vitest";

// lib/parse-menu (types + re-exports) pulls lib/anthropic → lib/env; no secrets offline.
vi.mock("@/lib/env", () => ({ requireEnv: () => "unused", env: {} }));

import { paiseToRupees } from "@/lib/currency";
import { addMenuItemsInputSchema, postProcessMenuDraft } from "@/lib/parse-menu";

import { compareMenuDraft, loadFixtures, loadMenu, menuForParse, validateFixtures } from "./fixtures";

/**
 * Offline golden voice-menu sanity: runs in CI, no network, no LLM.
 * `npm run test:golden:menu:validate`
 */

describe("golden parse-menu: menu integrity", () => {
  const menu = loadMenu();

  it("loads a non-empty menu with unique ids/names and integer-paise prices", () => {
    expect(menu.length).toBeGreaterThan(0);
    expect(new Set(menu.map((m) => m.id)).size).toBe(menu.length);
    expect(new Set(menu.map((m) => m.name.toLowerCase())).size).toBe(menu.length);
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

describe("golden parse-menu: fixture integrity", () => {
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
    for (const t of ["indic-numerals", "category-scope", "existing-match", "update-price", "no-price", "dedupe", "unparsed"]) {
      expect(tags.has(t), `missing tag: ${t}`).toBe(true);
    }
  });

  it("an ideal model answer passes post-processing + comparison for every fixture", () => {
    // Feed each expectation back as the tool input a perfect model would send:
    // proves the expectations are reachable through postProcessMenuDraft().
    const menu = menuForParse(loadMenu());
    const byId = new Map(menu.map((m) => [m.id, m]));
    for (const fx of fixtures) {
      const raw = addMenuItemsInputSchema.parse({
        items: fx.expected.items.map((i) => {
          const paise = i.priceInPaise ?? (i.existingMenuItemId ? byId.get(i.existingMenuItemId)!.priceInPaise : 1_000);
          const price = i.priceSpoken === false ? null : paiseToRupees(paise);
          return { name: i.name, priceRupees: price, category: i.category ?? null, existingMenuItemId: i.existingMenuItemId ?? null };
        }),
        unparsed: fx.expected.unparsed,
      });
      const diff = compareMenuDraft(fx.expected, postProcessMenuDraft(raw, menu, "haiku"));
      expect(diff.problems, fx.id).toEqual([]);
    }
  });
});
