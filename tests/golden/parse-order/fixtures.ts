/**
 * Golden-test fixture loader.
 *
 * Each fixture is a JSON file under `tests/golden/parse-order/fixtures/` with
 * the schema below. Loading happens at test time; we read the directory once
 * per test process, validate every file via Zod, and surface clear errors so
 * a malformed fixture fails fast.
 */

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import type { MenuItemForParse } from "@/lib/anthropic";

const FIXTURES_DIR = path.resolve(__dirname, "fixtures");
const MENU_PATH = path.resolve(__dirname, "menu.json");

export const fixtureSchema = z.object({
  id: z.string().regex(/^[a-z]{2}-\d{3}-[a-z0-9-]+$/, {
    message: "fixture.id must match <lang>-<NNN>-<slug> (e.g. hi-001-simple-quantity)",
  }),
  lang: z.enum(["en-IN", "hi-IN", "te-IN", "kn-IN", "ta-IN"]),
  transcript: z.string().min(1),
  expected: z.object({
    items: z
      .array(
        z.object({
          menuItemId: z.string().min(1),
          qty: z.number().int().min(1),
        }),
      )
      .default([]),
    unmatched: z.array(z.string()).default([]),
    minConfidence: z.enum(["high", "medium", "low"]).default("medium"),
  }),
  tags: z.array(z.string()).default([]),
  notes: z.string().optional(),
});

export type Fixture = z.infer<typeof fixtureSchema>;

export const menuItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  priceInPaise: z.number().int().positive(),
});

export type GoldenMenuItem = z.infer<typeof menuItemSchema>;

export function loadMenu(): GoldenMenuItem[] {
  const raw = JSON.parse(fs.readFileSync(MENU_PATH, "utf8")) as unknown;
  return z.array(menuItemSchema).parse(raw);
}

/** The Anthropic adapter expects a slightly different shape; map at the boundary. */
export function menuForParse(items: GoldenMenuItem[]): MenuItemForParse[] {
  return items.map((m) => ({
    id: m.id,
    name: m.name,
    aliases: m.aliases,
    priceInPaise: m.priceInPaise,
  }));
}

export function loadFixtures(): Fixture[] {
  if (!fs.existsSync(FIXTURES_DIR)) return [];
  const files = fs
    .readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();
  return files.map((f) => {
    const raw = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, f), "utf8")) as unknown;
    try {
      return fixtureSchema.parse(raw);
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new Error(
          `Fixture ${f} failed validation:\n${err.issues
            .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
            .join("\n")}`,
        );
      }
      throw err;
    }
  });
}

/**
 * Validate that every fixture references menu items that actually exist in
 * the menu. Returns a list of descriptive errors (empty when everything is OK).
 */
export function validateFixtureMenuRefs(
  fixtures: Fixture[],
  menu: GoldenMenuItem[],
): string[] {
  const ids = new Set(menu.map((m) => m.id));
  const errors: string[] = [];
  for (const fx of fixtures) {
    for (const item of fx.expected.items) {
      if (!ids.has(item.menuItemId)) {
        errors.push(
          `fixture ${fx.id}: expected.items references unknown menuItemId "${item.menuItemId}"`,
        );
      }
    }
  }
  return errors;
}
