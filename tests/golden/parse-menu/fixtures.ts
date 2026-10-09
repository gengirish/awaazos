/**
 * Golden voice-menu fixtures: loader, schema, offline checks and the draft
 * comparison used by the live runner.
 *
 * `expected.items` lists EVERY dish the draft should contain (extra rows fail),
 * in any order; each row asserts only the fields it lists. Rows are matched to
 * draft rows by `existingMenuItemId` when given, else by name (case-insensitive).
 */

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import type { ExistingMenuItem } from "@/lib/parse-menu";
import type { MenuDraft, MenuDraftItem } from "@/lib/parse-menu-types";
import { MENU_BULK_MAX_ITEMS, MENU_MAX_PRICE_PAISE } from "@/lib/zod-menu";

const FIXTURES_DIR = path.resolve(__dirname, "fixtures");
const MENU_PATH = path.resolve(__dirname, "menu.json");

const expectedItemSchema = z
  .object({
    name: z.string().min(1).max(80),
    action: z.enum(["create", "update_price", "unchanged"]).optional(),
    existingMenuItemId: z.string().min(1).optional(),
    priceInPaise: z.number().int().positive().max(MENU_MAX_PRICE_PAISE).optional(),
    priceSpoken: z.boolean().optional(),
    category: z.string().min(1).max(80).optional(),
  })
  .strict();

export const fixtureSchema = z
  .object({
    id: z.string().regex(/^[a-z]{2}-\d{3}-[a-z0-9-]+$/, {
      message: "fixture.id must match <lang>-<NNN>-<slug> (e.g. hi-001-headline)",
    }),
    lang: z.enum(["en-IN", "hi-IN", "te-IN", "kn-IN", "ta-IN"]),
    transcript: z.string().min(1).max(2000),
    expected: z
      .object({
        items: z.array(expectedItemSchema).max(MENU_BULK_MAX_ITEMS).default([]),
        /** Substrings (case-insensitive) that must appear in some unparsed fragment. */
        unparsed: z.array(z.string().min(1)).default([]),
      })
      .strict(),
    tags: z.array(z.string()).default([]),
    notes: z.string().optional(),
  })
  .strict();

export type MenuFixture = z.infer<typeof fixtureSchema>;
type ExpectedItem = z.infer<typeof expectedItemSchema>;

export const menuItemSchema = z.object({
  id: z.string().min(1),
  slug: z.string().optional(),
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  priceInPaise: z.number().int().positive(),
  category: z.string().min(1),
  emoji: z.string().min(1),
});

export type GoldenMenuItem = z.infer<typeof menuItemSchema>;

export function loadMenu(): GoldenMenuItem[] {
  return z.array(menuItemSchema).parse(JSON.parse(fs.readFileSync(MENU_PATH, "utf8")));
}

export function menuForParse(items: GoldenMenuItem[]): ExistingMenuItem[] {
  return items.map((m) => ({
    id: m.id,
    slug: m.slug ?? null,
    name: m.name,
    aliases: m.aliases,
    tags: m.tags,
    priceInPaise: m.priceInPaise,
    category: m.category,
    emoji: m.emoji,
  }));
}

export function loadFixtures(): MenuFixture[] {
  if (!fs.existsSync(FIXTURES_DIR)) return [];
  return fs
    .readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const raw = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, f), "utf8")) as unknown;
      const parsed = fixtureSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(
          `Fixture ${f} failed validation:\n${parsed.error.issues
            .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
            .join("\n")}`,
        );
      }
      if (`${parsed.data.id}.json` !== f) throw new Error(`Fixture ${f}: id "${parsed.data.id}" doesn't match filename`);
      return parsed.data;
    });
}

/** Menu refs + internal consistency of each expectation. Empty array = OK. */
export function validateFixtures(fixtures: MenuFixture[], menu: GoldenMenuItem[]): string[] {
  const byId = new Map(menu.map((m) => [m.id, m]));
  const errors: string[] = [];
  for (const fx of fixtures) {
    const names = new Set<string>();
    const ids = new Set<string>();
    for (const item of fx.expected.items) {
      const key = item.name.toLowerCase();
      if (names.has(key)) errors.push(`${fx.id}: "${item.name}" listed twice`);
      names.add(key);
      if (item.existingMenuItemId) {
        const m = byId.get(item.existingMenuItemId);
        if (!m) {
          errors.push(`${fx.id}: unknown existingMenuItemId "${item.existingMenuItemId}"`);
          continue;
        }
        if (ids.has(m.id)) errors.push(`${fx.id}: existingMenuItemId "${m.id}" listed twice`);
        ids.add(m.id);
        if (m.name.toLowerCase() !== key) errors.push(`${fx.id}: "${item.name}" should use the menu name "${m.name}"`);
        if (item.action === "create") errors.push(`${fx.id}: "${item.name}" has an existing id but action create`);
        if (item.action === "unchanged" && item.priceInPaise !== undefined && item.priceInPaise !== m.priceInPaise) {
          errors.push(`${fx.id}: "${item.name}" unchanged but price differs from the menu`);
        }
        if (item.action === "update_price" && item.priceInPaise === m.priceInPaise) {
          errors.push(`${fx.id}: "${item.name}" update_price to the same price`);
        }
        if (item.category !== undefined && item.category !== m.category) {
          errors.push(`${fx.id}: "${item.name}" existing items keep their category (${m.category})`);
        }
      } else {
        if (item.action && item.action !== "create") {
          errors.push(`${fx.id}: "${item.name}" is ${item.action} without an existingMenuItemId`);
        }
        if (menu.some((m) => m.name.toLowerCase() === key)) {
          errors.push(`${fx.id}: "${item.name}" is on the menu — give its existingMenuItemId`);
        }
        if (item.priceSpoken === false && item.priceInPaise !== undefined) {
          errors.push(`${fx.id}: "${item.name}" new dish without a spoken price can't expect a price`);
        }
      }
      if (item.priceSpoken === false && item.action === "update_price") {
        errors.push(`${fx.id}: "${item.name}" update_price needs a spoken price`);
      }
    }
    if (fx.expected.items.length === 0 && fx.expected.unparsed.length === 0) {
      errors.push(`${fx.id}: expects neither items nor unparsed — nothing to check`);
    }
  }
  return errors;
}

export type DraftDiff = { pass: boolean; problems: string[] };

function findRow(want: ExpectedItem, items: MenuDraftItem[]): MenuDraftItem | undefined {
  if (want.existingMenuItemId) return items.find((i) => i.existingMenuItemId === want.existingMenuItemId);
  return items.find((i) => i.name.toLowerCase() === want.name.toLowerCase());
}

/** Strict on everything `expected` lists; extra dishes in the draft fail too. */
export function compareMenuDraft(expected: MenuFixture["expected"], draft: MenuDraft): DraftDiff {
  const problems: string[] = [];
  const used = new Set<MenuDraftItem>();
  for (const want of expected.items) {
    const row = findRow(want, draft.items);
    if (!row) {
      problems.push(`items: missing ${want.existingMenuItemId ?? want.name}`);
      continue;
    }
    used.add(row);
    for (const k of ["action", "existingMenuItemId", "priceInPaise", "priceSpoken", "category"] as const) {
      if (want[k] !== undefined && row[k] !== want[k]) {
        problems.push(`items[${want.name}].${k}: expected ${JSON.stringify(want[k])}, got ${JSON.stringify(row[k])}`);
      }
    }
  }
  for (const row of draft.items) {
    if (!used.has(row)) problems.push(`items: unexpected ${row.name}`);
  }
  for (const frag of expected.unparsed) {
    if (!draft.unparsed.some((u) => u.toLowerCase().includes(frag.toLowerCase()))) {
      problems.push(`unparsed: expected "${frag}" in ${JSON.stringify(draft.unparsed)}`);
    }
  }
  return { pass: problems.length === 0, problems };
}
