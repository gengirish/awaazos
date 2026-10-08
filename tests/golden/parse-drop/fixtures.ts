/**
 * Golden voice-drop fixtures: loader, schema, offline checks and the draft
 * comparison used by the live runner.
 *
 * Each fixture pins `now` (an ISO instant) so relative days ("aaj", "kal",
 * "shanivaar") resolve the same way on every run. `expected` is a PARTIAL
 * DropDraft: only the fields listed are asserted.
 */

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import type { MenuItemForParse } from "@/lib/anthropic";
import type { DropDraft } from "@/lib/parse-drop-types";

const FIXTURES_DIR = path.resolve(__dirname, "fixtures");
const MENU_PATH = path.resolve(__dirname, "menu.json");

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const fixtureSchema = z
  .object({
    id: z.string().regex(/^[a-z]{2}-\d{3}-[a-z0-9-]+$/, {
      message: "fixture.id must match <lang>-<NNN>-<slug> (e.g. hi-001-headline)",
    }),
    lang: z.enum(["en-IN", "hi-IN", "te-IN", "kn-IN", "ta-IN"]),
    now: z.string().datetime(),
    transcript: z.string().min(1).max(1000),
    expected: z
      .object({
        title: z.string().optional(),
        date: ymd.optional(),
        fulfilmentMode: z.enum(["DELIVERY", "PICKUP", "BOTH"]).optional(),
        fulfilmentStart: hm.optional(),
        fulfilmentEnd: hm.optional(),
        deliveryFeePaise: z.number().int().nonnegative().optional(),
        opensAtDate: ymd.optional(),
        opensAtTime: hm.optional(),
        closesAtDate: ymd.optional(),
        closesAtTime: hm.optional(),
        showEverydayMenu: z.boolean().optional(),
        items: z
          .array(
            z
              .object({
                menuItemId: z.string().min(1),
                maxQty: z.number().int().min(1).max(10_000).nullable().optional(),
                priceInPaise: z.number().int().positive().optional(),
                perOrderLimit: z.number().int().min(1).max(1_000).nullable().optional(),
              })
              .strict(),
          )
          .default([]),
        /** Substrings (case-insensitive) that must appear in some unmatched spokenName. */
        unmatched: z.array(z.string().min(1)).default([]),
      })
      .strict(),
    tags: z.array(z.string()).default([]),
    notes: z.string().optional(),
  })
  .strict();

export type DropFixture = z.infer<typeof fixtureSchema>;

export const menuItemSchema = z.object({
  id: z.string().min(1),
  slug: z.string().optional(),
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  priceInPaise: z.number().int().positive(),
});

export type GoldenMenuItem = z.infer<typeof menuItemSchema>;

export function loadMenu(): GoldenMenuItem[] {
  return z.array(menuItemSchema).parse(JSON.parse(fs.readFileSync(MENU_PATH, "utf8")));
}

export function menuForParse(items: GoldenMenuItem[]): MenuItemForParse[] {
  return items.map((m) => ({
    id: m.id,
    slug: m.slug ?? null,
    name: m.name,
    aliases: m.aliases,
    tags: m.tags,
    priceInPaise: m.priceInPaise,
  }));
}

export function loadFixtures(): DropFixture[] {
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
export function validateFixtures(fixtures: DropFixture[], menu: GoldenMenuItem[]): string[] {
  const ids = new Set(menu.map((m) => m.id));
  const errors: string[] = [];
  for (const fx of fixtures) {
    const e = fx.expected;
    const seen = new Set<string>();
    for (const item of e.items) {
      if (!ids.has(item.menuItemId)) errors.push(`${fx.id}: unknown menuItemId "${item.menuItemId}"`);
      if (seen.has(item.menuItemId)) errors.push(`${fx.id}: menuItemId "${item.menuItemId}" listed twice`);
      seen.add(item.menuItemId);
      if (item.perOrderLimit != null && item.maxQty != null && item.perOrderLimit > item.maxQty) {
        errors.push(`${fx.id}: perOrderLimit > maxQty for "${item.menuItemId}"`);
      }
    }
    for (const key of ["date", "closesAtDate", "opensAtDate"] as const) {
      const v = e[key];
      if (v && new Date(`${v}T00:00:00.000Z`).toISOString().slice(0, 10) !== v) {
        errors.push(`${fx.id}: ${key} "${v}" is not a real day`);
      }
    }
    if (e.fulfilmentStart && e.fulfilmentEnd && e.fulfilmentEnd <= e.fulfilmentStart) {
      errors.push(`${fx.id}: fulfilmentEnd must be after fulfilmentStart`);
    }
    if (e.date && e.fulfilmentStart && e.closesAtDate && e.closesAtTime) {
      if (`${e.closesAtDate}T${e.closesAtTime}` > `${e.date}T${e.fulfilmentStart}`) {
        errors.push(`${fx.id}: expected cut-off is after the window starts`);
      }
    }
    if ((e.opensAtDate == null) !== (e.opensAtTime == null)) {
      errors.push(`${fx.id}: give both opensAtDate and opensAtTime, or neither`);
    }
    if (e.items.length === 0 && e.unmatched.length === 0) {
      errors.push(`${fx.id}: expects neither items nor unmatched — nothing to check`);
    }
  }
  return errors;
}

const SCALAR_KEYS = [
  "title",
  "date",
  "fulfilmentMode",
  "fulfilmentStart",
  "fulfilmentEnd",
  "deliveryFeePaise",
  "opensAtDate",
  "opensAtTime",
  "closesAtDate",
  "closesAtTime",
  "showEverydayMenu",
] as const;

export type DraftDiff = { pass: boolean; problems: string[] };

/** Strict on everything `expected` lists; extra items in the draft fail too. */
export function compareDraft(expected: DropFixture["expected"], draft: DropDraft): DraftDiff {
  const problems: string[] = [];
  for (const key of SCALAR_KEYS) {
    const want = expected[key];
    if (want === undefined) continue;
    if (draft[key] !== want) problems.push(`${key}: expected ${JSON.stringify(want)}, got ${JSON.stringify(draft[key])}`);
  }
  const got = new Map(draft.items.map((i) => [i.menuItemId, i]));
  for (const want of expected.items) {
    const item = got.get(want.menuItemId);
    if (!item) {
      problems.push(`items: missing ${want.menuItemId}`);
      continue;
    }
    for (const k of ["maxQty", "priceInPaise", "perOrderLimit"] as const) {
      if (want[k] !== undefined && item[k] !== want[k]) {
        problems.push(`items[${want.menuItemId}].${k}: expected ${want[k]}, got ${item[k]}`);
      }
    }
  }
  const wantIds = new Set(expected.items.map((i) => i.menuItemId));
  for (const item of draft.items) {
    if (!wantIds.has(item.menuItemId)) problems.push(`items: unexpected ${item.menuItemId}`);
  }
  for (const frag of expected.unmatched) {
    const hit = draft.unmatched.some((u) => u.spokenName.toLowerCase().includes(frag.toLowerCase()));
    if (!hit) problems.push(`unmatched: expected "${frag}" in ${JSON.stringify(draft.unmatched)}`);
  }
  return { pass: problems.length === 0, problems };
}
