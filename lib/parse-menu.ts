/**
 * Voice menu builder: transcript → DRAFT list of dishes (nothing is saved here).
 *
 * Same shape as the order and drop paths (lib/anthropic.ts, lib/parse-drop.ts):
 *   - STT already happened; only the transcript + this vendor's menu reach Claude.
 *   - Forced `add_menu_items` tool use, Haiku primary → Sonnet escalation.
 *   - Cached block = `stableMenuJson()` (+ the vendor's sorted category list) with
 *     `cache_control: ephemeral`; the transcript sits in a later, uncached block.
 *   - Model output is never trusted: names are cleaned, existing items are matched
 *     here (a model-supplied id is only accepted when it is THIS vendor's and the
 *     names agree), rupees → paise go through `rupeesToPaise`, absurd prices are
 *     dropped, repeats are merged, categories snap to existing spellings.
 *
 * The vendor confirms the draft and the UI saves it with POST /api/menu/bulk.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import {
  ANTHROPIC_FALLBACK_MODEL,
  ANTHROPIC_PRIMARY_MODEL,
  anthropicHaiku,
  anthropicSonnet,
  stableMenuJson,
  type MenuItemForParse,
} from "@/lib/anthropic";
import { formatINRCompact, rupeesToPaise } from "@/lib/currency";
import { suggestAliases, suggestEmoji } from "@/lib/menu-suggestions";
import { levenshtein, normalizeForMatch } from "@/lib/parse-order-align";
import type { MenuDraft, MenuDraftItem } from "@/lib/parse-menu-types";
import { MENU_BULK_MAX_ITEMS, MENU_MAX_PRICE_PAISE, MENU_NAME_MAX } from "@/lib/zod-menu";

export type { MenuDraft, MenuDraftAction, MenuDraftItem } from "@/lib/parse-menu-types";

// ─── Limits ──────────────────────────────────────────────────────────────────

/** Same caps as POST /api/menu/bulk, so every draft row can be saved. */
export const MENU_DRAFT_MAX_ITEMS = MENU_BULK_MAX_ITEMS;
export { MENU_MAX_PRICE_PAISE, MENU_NAME_MAX };
const CATEGORY_MAX = 80;
const MAX_SPOKEN_ALIASES = 10;
const MAX_UNPARSED = 20;
const DEFAULT_CATEGORY = "General";
const DEFAULT_EMOJI = "🍽️";

/** Whole-string similarity a server-side fuzzy match needs to reuse an existing item. */
export const FUZZY_MATCH_MIN = 0.85;
/** Similarity a model-supplied existing id needs before we believe it. */
export const MODEL_ID_MATCH_MIN = 0.6;

/** Per-request client overrides: a long dictation can produce a few thousand output tokens. */
const HAIKU_REQUEST = { timeout: 15_000, maxRetries: 1 } as const;
const SONNET_REQUEST = { timeout: 25_000, maxRetries: 0 } as const;

// ─── Prompt + tool ───────────────────────────────────────────────────────────

const MENU_BUILD_SYSTEM = `You turn an Indian street-food stall or home-kitchen owner's spoken list of dishes into draft menu rows they will review before saving.
Use the add_menu_items tool exactly once, with one entry per dish, in the order spoken. Never invent dishes or prices.

Speech is Hinglish, English or Hindi (sometimes Telugu/Kannada/Tamil transliterated) and comes from speech-to-text, so words may be misheard. Fix obvious mishearings of common dish names (e.g. "masla chai" → "Masala Chai", "wada pav" → "Vada Pav").

Dishes:
- name = the dish as a menu would print it, in Latin script, Title Case. Leave out prices, quantities and filler words ("aur", "and", "phir", "hai", "wala" when it is not part of the name).
- If the dish is already on the existing menu (same dish, even if said differently or by an alias), set existingMenuItemId to that item's "id" from the menu JSON. Never invent ids, never use "slug". Different variants are different dishes ("Cutting Chai" is not "Masala Chai").
- spokenAliases = other names the owner used for the same dish in this list (e.g. "bun maska ya maska pav" → name "Bun Maska", spokenAliases ["maska pav"]). Usually empty.

Prices:
- priceRupees = the selling price in rupees for one portion, or null when no price was said for that dish. Never guess a price.
- A number right after a dish is its price ("samosa 20" → 20). "rupaye", "rupees", "rs", "₹", "ka", "wala" mark money.
- "ek plate", "do plate", "half", "full", "piece" describe the portion, not the price ("pav bhaji do plate 80" → 80). If half and full prices are given, make two dishes ("Pav Bhaji (Half)", "Pav Bhaji (Full)").
- Hindi numbers: ek 1, do 2, teen 3, char 4, paanch 5, chhe 6, saat 7, aath 8, nau 9, das 10, gyarah 11, barah 12, terah 13, chaudah 14, pandrah 15, solah 16, satrah 17, atharah 18, unnees 19, bees 20, pachees 25, tees 30, paintees 35, chalees 40, pachaas 50, saath 60, sattar 70, assi 80, nabbe 90, sau 100, hazaar 1000.
- dedh = 1.5 (dedh sau = 150), dhai = 2.5 (dhai sau = 250), saade X = X + 0.5 (saade teen sau = 350, saade das = 10.5), sava X = X + 0.25 (sava sau = 125), paune X = X − 0.25 (paune do sau = 175). "X sau Y" = X×100 + Y (do sau pachaas = 250).
- te: okati 1, rendu 2, moodu 3, padi 10, iravai 20, vanda 100 · kn: ondu 1, eradu 2, hattu 10, ippattu 20, nooru 100 · ta: onnu 1, rendu 2, pathu 10, irupathu 20, nooru 100.

Categories:
- "X mein", "X wale", "X wala section", "under X", "in X" name the category X for the run of dishes said just before it, back to the previous category phrase (or the start). Example: "chai 10, coffee 20 — drinks mein; samosa 15, kachori 20, snacks mein" → chai and coffee are Drinks, samosa and kachori are Snacks.
- A category said BEFORE a list ("snacks mein: samosa, kachori") applies to the dishes that follow, until the next category phrase.
- When the owner names a category that matches one in "Existing categories" (ignoring case or plural), use the existing spelling.
- When no category was said for a dish, infer a short one from the dish type, preferring an existing category (Chai/Drinks for beverages, Snacks for fried snacks, Meals, Sweets, …); use null if unsure.

Put any fragment you could not turn into a dish (instructions, chit-chat, unclear words) into unparsed.

The authoritative existing menu JSON and category list are provided in a separate user message block (cached).`;

export const ADD_MENU_ITEMS_TOOL: Anthropic.Tool = {
  name: "add_menu_items",
  description: "Add the dishes the owner listed as draft menu rows. One entry per dish, in spoken order.",
  input_schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Dish name, Title Case, Latin script" },
            priceRupees: { type: ["number", "null"], description: "Price in rupees, null if not said" },
            category: { type: ["string", "null"], description: "Spoken or inferred category, null if unsure" },
            spokenAliases: { type: "array", items: { type: "string" } },
            existingMenuItemId: {
              type: ["string", "null"],
              description: "id from the existing menu JSON when this dish is already on it",
            },
          },
          required: ["name", "priceRupees", "category"],
        },
      },
      unparsed: { type: "array", items: { type: "string" } },
    },
    required: ["items"],
  },
};

// ─── Tool-input validation (lenient: coerce, then re-check everything) ───────

/** null / "" → undefined; numeric strings → number. No money rounding here. */
const optNum = z.preprocess(
  (v) => (v === null || v === "" ? undefined : typeof v === "string" ? Number(v.replace(/[₹,\s]/g, "")) : v),
  z.number().optional(),
);
const optStr = z.preprocess((v) => (v === null ? undefined : v), z.string().optional());

export const addMenuItemsInputSchema = z.object({
  items: z
    .array(
      z.object({
        name: z.preprocess((v) => (v === null ? "" : v), z.string().default("")),
        priceRupees: optNum,
        category: optStr,
        spokenAliases: z.preprocess(
          (v) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []),
          z.array(z.string()),
        ),
        existingMenuItemId: z.preprocess((v) => (v === "" ? null : v), z.string().nullish()),
      }),
    )
    .default([]),
  unparsed: z.preprocess(
    (v) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []),
    z.array(z.string()),
  ),
});

export type AddMenuItemsToolInput = z.infer<typeof addMenuItemsInputSchema>;

// ─── Claude call ─────────────────────────────────────────────────────────────

/** Existing menu rows: what stableMenuJson needs, plus display fields for the draft. */
export type ExistingMenuItem = MenuItemForParse & {
  category?: string | null;
  emoji?: string | null;
};

/** Distinct existing categories, sorted — deterministic so the cached block stays byte-identical. */
export function existingCategories(menuItems: ExistingMenuItem[]): string[] {
  const set = new Set<string>();
  for (const m of menuItems) {
    const c = m.category?.trim();
    if (c) set.add(c);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** The cached block: menu JSON (stableMenuJson, unchanged) + the category list. */
export function menuBuilderCachedText(menuItems: ExistingMenuItem[]): string {
  return `Authoritative menu (JSON):\n${stableMenuJson(menuItems)}\nExisting categories (JSON):\n${JSON.stringify(existingCategories(menuItems))}`;
}

function extractInput(message: Anthropic.Messages.Message): unknown {
  for (const block of message.content) {
    if (block.type === "tool_use" && block.name === "add_menu_items") return block.input;
  }
  throw new Error("No add_menu_items tool_use in response");
}

/** One forced add_menu_items call. Throws on API error, missing tool_use, or invalid input. */
export async function buildMenuWithClaude(
  modelClient: Anthropic,
  modelName: string,
  menuItems: ExistingMenuItem[],
  transcript: string,
  lang: string,
): Promise<AddMenuItemsToolInput> {
  const message = await modelClient.messages.create(
    {
      model: modelName,
      max_tokens: 4096,
      temperature: 0.1,
      system: MENU_BUILD_SYSTEM,
      tools: [ADD_MENU_ITEMS_TOOL],
      tool_choice: { type: "tool", name: "add_menu_items", disable_parallel_tool_use: true },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: menuBuilderCachedText(menuItems), cache_control: { type: "ephemeral" } },
            { type: "text", text: `Owner's dish list (${lang}):\n${transcript}` },
          ],
        },
      ],
    },
    modelName === ANTHROPIC_FALLBACK_MODEL ? SONNET_REQUEST : HAIKU_REQUEST,
  );
  return addMenuItemsInputSchema.parse(extractInput(message));
}

function wordCount(transcript: string): number {
  return transcript.trim().split(/\s+/).filter(Boolean).length;
}

const NUMBER_WORDS =
  /\b(ek|do|teen|char|chaar|paanch|panch|chhe|saat|aath|nau|das|bees|pachees|tees|chalees|pachaas|pachas|saath|sattar|assi|nabbe|sau|hazaar|hazar|dedh|dhai|saade|sava|paune|rupaye|rupaiye|rupees?|rs|one|two|three|four|five|ten|twenty|thirty|forty|fifty|hundred)\b|\d|₹/i;

/** True when the transcript says any number at all — otherwise missing prices are genuinely missing. */
export function transcriptHasNumbers(transcript: string): boolean {
  return NUMBER_WORDS.test(transcript);
}

/**
 * Escalate Haiku → Sonnet (besides a Haiku throw) when:
 *  (a) no dishes at all on a > 3-word transcript, or
 *  (b) more than half the dishes came back without a price although the
 *      transcript does contain numbers (a list said without prices is fine).
 */
export function shouldEscalateMenu(result: AddMenuItemsToolInput, transcript: string): boolean {
  if (result.items.length === 0) return wordCount(transcript) > 3;
  const missing = result.items.filter((i) => i.priceRupees === undefined).length;
  return missing * 2 > result.items.length && transcriptHasNumbers(transcript);
}

export type ParseMenuOutcome = {
  draft: MenuDraft;
  modelUsed: string;
  escalated: boolean;
};

/** Full pipeline: Haiku → (maybe) Sonnet → post-process. Throws only when no tier produced a usable tool call. */
export async function parseMenuFromTranscript(opts: {
  menuItems: ExistingMenuItem[];
  transcript: string;
  lang: string;
  clients?: { haiku: Anthropic; sonnet: Anthropic };
}): Promise<ParseMenuOutcome> {
  const haiku = opts.clients?.haiku ?? anthropicHaiku;
  const sonnet = opts.clients?.sonnet ?? anthropicSonnet;
  const run = (client: Anthropic, model: string) =>
    buildMenuWithClaude(client, model, opts.menuItems, opts.transcript, opts.lang);

  let raw: AddMenuItemsToolInput;
  let tier: "haiku" | "sonnet" = "haiku";
  try {
    raw = await run(haiku, ANTHROPIC_PRIMARY_MODEL);
  } catch {
    tier = "sonnet";
    raw = await run(sonnet, ANTHROPIC_FALLBACK_MODEL);
  }
  if (tier === "haiku" && shouldEscalateMenu(raw, opts.transcript)) {
    try {
      raw = await run(sonnet, ANTHROPIC_FALLBACK_MODEL);
      tier = "sonnet";
    } catch {
      // Haiku's weak-but-valid answer beats nothing; the vendor reviews it anyway.
    }
  }

  return {
    draft: postProcessMenuDraft(raw, opts.menuItems, tier),
    modelUsed: tier === "sonnet" ? ANTHROPIC_FALLBACK_MODEL : ANTHROPIC_PRIMARY_MODEL,
    escalated: tier === "sonnet",
  };
}

// ─── Post-processing (never trust the model) ─────────────────────────────────

/** Capitalise all-lowercase words; leave words with capitals ("BBQ", "McAloo") alone. */
function titleCase(s: string): string {
  return s
    .split(" ")
    .map((w) => (/^[a-z][a-z0-9'’-]*$/.test(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

const CURRENCY_TAIL = /\s*(?:[-–—:,]\s*)?(?:(?:₹|rs\.?|inr)\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:₹|rs\.?|rupaye|rupaiye|rupees?|rupay|\/-))\s*$/i;

/** Model name → display name: no stray price/punctuation, single spaces, Title Case, <= 80 chars. */
export function cleanDishName(raw: string): string {
  let s = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  s = s.replace(CURRENCY_TAIL, "");
  s = s.replace(/^[\s"'“”‘’.,;:!?*•\-–—]+|[\s"'“”‘’.,;:!?*•\-–—]+$/g, "");
  s = s.replace(/\s+/g, " ").trim();
  return titleCase(s).slice(0, MENU_NAME_MAX).trim();
}

const CATEGORY_SUFFIX = /\s+(?:mein|me|main|wale|wala|wali|section|items?)$/i;
const CATEGORY_PREFIX = /^(?:under|in)\s+/i;

/** Model category → display category (Title Case, <= 80), or null when empty. */
export function cleanCategory(raw: string | undefined): string | null {
  if (!raw) return null;
  let s = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  s = s.replace(/^[\s"'“”.,;:!?\-–—]+|[\s"'“”.,;:!?\-–—]+$/g, "");
  s = s.replace(CATEGORY_PREFIX, "").replace(CATEGORY_SUFFIX, "").trim();
  if (!s) return null;
  return titleCase(s).slice(0, CATEGORY_MAX).trim() || null;
}

/** Case- and simple-plural-insensitive key: "Snacks" / "snack" / "SNACKS" → "snack". */
function categoryKey(c: string): string {
  const k = c.toLowerCase().replace(/\s+/g, " ").trim();
  return k.length > 3 && k.endsWith("s") && !k.endsWith("ss") ? k.slice(0, -1) : k;
}

/** 0..1 whole-string similarity on normalised text. */
export function nameSimilarity(a: string, b: string): number {
  const x = normalizeForMatch(a);
  const y = normalizeForMatch(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length, 1);
}

function labelsOf(m: ExistingMenuItem): string[] {
  return [m.name, ...m.aliases];
}

function bestSimilarity(name: string, m: ExistingMenuItem): number {
  let best = 0;
  for (const label of labelsOf(m)) best = Math.max(best, nameSimilarity(name, label));
  return best;
}

type ExistingMatch =
  | { item: ExistingMenuItem; how: "exact" | "alias" | "model" | "fuzzy" }
  | { ambiguous: ExistingMenuItem[] }
  | null;

/**
 * Find the existing menu row a spoken dish refers to:
 *  1. exact (normalised) name or alias — unique hit, or the model's id among several.
 *     An alias-only hit is reported as "alias", not "exact": default aliases are
 *     single words ("chai" for Masala Chai), so "chai 10" must be flagged for review
 *     rather than silently becoming a price update on Masala Chai;
 *  2. the model's id, when it is THIS vendor's item and the names are ≥ 0.6 similar;
 *  3. server-side fuzzy match ≥ 0.85 with a clear winner.
 * Anything weaker is a new dish.
 */
export function matchExistingItem(
  name: string,
  modelId: string | null | undefined,
  menuItems: ExistingMenuItem[],
): ExistingMatch {
  const norm = normalizeForMatch(name);
  if (!norm) return null;
  const byId = new Map(menuItems.map((m) => [m.id, m]));
  const modelItem = modelId ? byId.get(modelId) : undefined;

  const exact = menuItems.filter((m) => labelsOf(m).some((l) => normalizeForMatch(l) === norm));
  if (exact.length > 0) {
    const byName = exact.filter((m) => normalizeForMatch(m.name) === norm);
    if (byName.length === 1) return { item: byName[0]!, how: "exact" };
    const how = (m: ExistingMenuItem) => (normalizeForMatch(m.name) === norm ? "exact" : "alias");
    if (exact.length === 1) return { item: exact[0]!, how: how(exact[0]!) };
    if (modelItem && exact.includes(modelItem)) return { item: modelItem, how: how(modelItem) };
    return { ambiguous: exact };
  }

  if (modelItem && bestSimilarity(name, modelItem) >= MODEL_ID_MATCH_MIN) {
    return { item: modelItem, how: "model" };
  }

  const scored = menuItems
    .map((m) => ({ m, s: bestSimilarity(name, m) }))
    .filter((x) => x.s >= FUZZY_MATCH_MIN)
    .sort((a, b) => b.s - a.s);
  if (scored.length === 0 || norm.length < 4) return null;
  if (scored.length > 1 && scored[1]!.s > scored[0]!.s - 0.05) return { ambiguous: scored.map((x) => x.m) };
  return { item: scored[0]!.m, how: "fuzzy" };
}

/** Spoken rupees → paise when it is a sane selling price, else null. */
export function spokenPriceToPaise(rupees: number | undefined): number | null {
  if (rupees === undefined || !Number.isFinite(rupees)) return null;
  let paise: number;
  try {
    paise = rupeesToPaise(rupees);
  } catch {
    return null;
  }
  if (paise <= 0 || paise > MENU_MAX_PRICE_PAISE) return null;
  return paise;
}

function cleanAlias(a: string): string {
  return a.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim().slice(0, MENU_NAME_MAX);
}

/**
 * Model tool input → MenuDraft. Pure: cleans names, matches existing items of
 * THIS vendor, converts money to paise, guards prices, merges repeats, snaps
 * categories to existing spellings and collects warnings.
 */
export function postProcessMenuDraft(
  raw: AddMenuItemsToolInput,
  menuItems: ExistingMenuItem[],
  model: "haiku" | "sonnet",
): MenuDraft {
  const warnings: string[] = [];
  const warn = (msg: string) => {
    if (!warnings.includes(msg)) warnings.push(msg);
  };
  const unparsed: string[] = [];
  const addUnparsed = (s: string) => {
    const t = s.replace(/\s+/g, " ").trim().slice(0, 200);
    if (t && !unparsed.includes(t) && unparsed.length < MAX_UNPARSED) unparsed.push(t);
  };

  // Existing category spellings win; new spellings are remembered so one
  // utterance doesn't produce "Drinks" and "drinks".
  const categoryByKey = new Map<string, string>();
  for (const c of existingCategories(menuItems)) {
    const k = categoryKey(c);
    if (!categoryByKey.has(k)) categoryByKey.set(k, c);
  }
  const resolveCategory = (spoken: string | undefined): string => {
    const c = cleanCategory(spoken);
    if (!c) return categoryByKey.get(categoryKey(DEFAULT_CATEGORY)) ?? DEFAULT_CATEGORY;
    const k = categoryKey(c);
    const known = categoryByKey.get(k);
    if (known) return known;
    categoryByKey.set(k, c);
    return c;
  };

  const rows: MenuDraftItem[] = [];
  const indexByKey = new Map<string, number>();

  for (const line of raw.items) {
    const name = cleanDishName(line.name);
    if (!name || !/[\p{L}]/u.test(name)) {
      if (line.name.trim()) addUnparsed(line.name);
      continue;
    }

    let priceInPaise = spokenPriceToPaise(line.priceRupees);
    if (line.priceRupees !== undefined && priceInPaise === null) {
      warn(`Price for ${name} doesn't look right — please enter it`);
    }

    const match = matchExistingItem(name, line.existingMenuItemId, menuItems);
    let row: MenuDraftItem;
    if (match && "item" in match) {
      const m = match.item;
      const spoken = priceInPaise !== null;
      const price = priceInPaise ?? m.priceInPaise;
      row = {
        key: `existing:${m.id}`,
        name: m.name,
        priceInPaise: price,
        category: m.category?.trim() || DEFAULT_CATEGORY,
        emoji: m.emoji || DEFAULT_EMOJI,
        aliases: [...m.aliases],
        action: spoken && price !== m.priceInPaise ? "update_price" : "unchanged",
        existingMenuItemId: m.id,
        existingPriceInPaise: m.priceInPaise,
        priceSpoken: spoken,
        ...(match.how !== "exact" ? { matchedFuzzy: true } : {}),
      };
      if (match.how !== "exact") warn(`"${name}" matched to ${m.name} on your menu — please check`);
    } else {
      if (match && "ambiguous" in match) {
        const names = match.ambiguous.slice(0, 3).map((m) => m.name).join(" or ");
        warn(`"${name}" could be ${names} — added as a new dish, please check`);
      }
      const spokenAliases = line.spokenAliases.map(cleanAlias).filter(Boolean).slice(0, MAX_SPOKEN_ALIASES);
      row = {
        key: `new:${normalizeForMatch(name) || name.toLowerCase()}`,
        name,
        priceInPaise: priceInPaise ?? 0,
        category: resolveCategory(line.category),
        emoji: suggestEmoji(name) ?? DEFAULT_EMOJI,
        aliases: Array.from(new Set([...suggestAliases(name), ...spokenAliases])),
        action: "create",
        existingMenuItemId: null,
        existingPriceInPaise: null,
        priceSpoken: priceInPaise !== null,
      };
    }

    // Same dish twice in one utterance: one row, the last spoken price wins.
    const at = indexByKey.get(row.key);
    if (at !== undefined) {
      const prev = rows[at]!;
      if (!row.priceSpoken && prev.priceSpoken) {
        priceInPaise = prev.priceInPaise;
        row = { ...row, priceInPaise: prev.priceInPaise, priceSpoken: true };
        if (row.existingPriceInPaise !== null) {
          row.action = priceInPaise !== row.existingPriceInPaise ? "update_price" : "unchanged";
        }
      }
      if (row.action === "create" && !line.category) row.category = prev.category;
      rows[at] = row;
      warn(
        row.priceSpoken
          ? `${row.name} was said more than once — kept ${formatINRCompact(row.priceInPaise)}`
          : `${row.name} was said more than once — kept one`,
      );
      continue;
    }
    if (rows.length >= MENU_DRAFT_MAX_ITEMS) {
      warn(`Only the first ${MENU_DRAFT_MAX_ITEMS} dishes were kept — add the rest in another go`);
      break;
    }
    indexByKey.set(row.key, rows.length);
    rows.push(row);
  }

  for (const row of rows) {
    if (!row.priceSpoken && row.action === "create") warn(`No price heard for ${row.name} — please enter it`);
  }
  for (const u of raw.unparsed) addUnparsed(u);
  if (rows.length === 0) warn("No dishes recognised — please try again or add them by hand");

  return { items: rows, warnings, unparsed, model };
}
