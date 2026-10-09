import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  requireEnv: vi.fn(() => "test-anthropic-key"),
  env: {} as Record<string, unknown>,
}));

import type Anthropic from "@anthropic-ai/sdk";

import { ANTHROPIC_FALLBACK_MODEL, ANTHROPIC_PRIMARY_MODEL } from "@/lib/anthropic";
import {
  addMenuItemsInputSchema,
  cleanCategory,
  cleanDishName,
  existingCategories,
  matchExistingItem,
  MENU_DRAFT_MAX_ITEMS,
  menuBuilderCachedText,
  parseMenuFromTranscript,
  postProcessMenuDraft,
  shouldEscalateMenu,
  spokenPriceToPaise,
  type ExistingMenuItem,
} from "@/lib/parse-menu";

const MENU: ExistingMenuItem[] = [
  { id: "mi_chai", name: "Masala Chai", aliases: ["masala chai", "chai"], priceInPaise: 1_500, category: "Chai", emoji: "☕" },
  { id: "mi_samosa", name: "Samosa", aliases: ["samosa"], priceInPaise: 2_000, category: "Snacks", emoji: "🥟" },
  { id: "mi_vada", name: "Vada Pav", aliases: ["vada pav", "vada", "pav"], priceInPaise: 2_500, category: "Snacks", emoji: "🍔" },
  { id: "mi_coffee", name: "Filter Coffee", aliases: ["filter coffee", "coffee"], priceInPaise: 3_000, category: "Chai", emoji: "☕" },
];

const input = (items: Record<string, unknown>[], unparsed: string[] = []) =>
  addMenuItemsInputSchema.parse({ items, unparsed });
const post = (items: Record<string, unknown>[], menu = MENU, unparsed: string[] = []) =>
  postProcessMenuDraft(input(items, unparsed), menu, "haiku");

describe("cleanDishName / cleanCategory", () => {
  it("Title Cases, strips stray prices and punctuation, caps length", () => {
    expect(cleanDishName("  masala   chai ")).toBe("Masala Chai");
    expect(cleanDishName("samosa 20 rupaye")).toBe("Samosa");
    expect(cleanDishName("Mango Lassi - ₹60")).toBe("Mango Lassi");
    expect(cleanDishName('"vada pav",')).toBe("Vada Pav");
    expect(cleanDishName("BBQ paneer")).toBe("BBQ Paneer");
    expect(cleanDishName("a".repeat(120))).toHaveLength(80);
  });

  it("drops scope words from categories", () => {
    expect(cleanCategory("snacks mein")).toBe("Snacks");
    expect(cleanCategory("under drinks")).toBe("Drinks");
    expect(cleanCategory("  ")).toBeNull();
    expect(cleanCategory(undefined)).toBeNull();
  });
});

describe("spokenPriceToPaise", () => {
  it("converts rupees via rupeesToPaise and rejects non-positive / absurd / sub-paise", () => {
    expect(spokenPriceToPaise(15)).toBe(1_500);
    expect(spokenPriceToPaise(10.5)).toBe(1_050);
    expect(spokenPriceToPaise(100_000)).toBe(10_000_000);
    expect(spokenPriceToPaise(100_001)).toBeNull();
    expect(spokenPriceToPaise(0)).toBeNull();
    expect(spokenPriceToPaise(-5)).toBeNull();
    expect(spokenPriceToPaise(12.345)).toBeNull();
    expect(spokenPriceToPaise(undefined)).toBeNull();
  });
});

describe("matchExistingItem", () => {
  it("exact name / alias, case-insensitive", () => {
    expect(matchExistingItem("SAMOSA", null, MENU)).toMatchObject({ item: { id: "mi_samosa" }, how: "exact" });
    // "chai" is only an alias of Masala Chai — reported as "alias" so it gets flagged.
    expect(matchExistingItem("Chai", null, MENU)).toMatchObject({ item: { id: "mi_chai" }, how: "alias" });
  });

  it("alias-only matches are flagged for review in the draft", () => {
    const draft = postProcessMenuDraft(
      { items: [{ name: "chai", priceRupees: 10, spokenAliases: [] }], unparsed: [] },
      MENU,
      "haiku",
    );
    const row = draft.items[0]!;
    expect(row.existingMenuItemId).toBe("mi_chai");
    expect(row.matchedFuzzy).toBe(true);
    expect(draft.warnings.some((w) => /please check/i.test(w))).toBe(true);
  });

  it("high-confidence fuzzy reuses an item; weak fuzzy does not", () => {
    expect(matchExistingItem("Samossa", null, MENU)).toMatchObject({ item: { id: "mi_samosa" }, how: "fuzzy" });
    expect(matchExistingItem("Vada Pao", null, MENU)).toMatchObject({ item: { id: "mi_vada" }, how: "fuzzy" });
    expect(matchExistingItem("Cutting Chai", null, MENU)).toBeNull();
    expect(matchExistingItem("Aloo Samosa", null, MENU)).toBeNull();
    expect(matchExistingItem("Mango Lassi", null, MENU)).toBeNull();
  });

  it("believes a model id only when it is this vendor's and the names agree", () => {
    expect(matchExistingItem("Smosa", "mi_samosa", MENU)).toMatchObject({ item: { id: "mi_samosa" }, how: "model" });
    // Wrong mapping (different dish) is ignored.
    expect(matchExistingItem("Cutting Chai", "mi_chai", MENU)).toBeNull();
    // Another vendor's id is unknown here.
    expect(matchExistingItem("Kachori", "mi_other_vendor", MENU)).toBeNull();
  });

  it("reports an alias shared by two items as ambiguous unless the model picked one", () => {
    const menu = [
      ...MENU,
      { id: "mi_cut", name: "Cutting Chai", aliases: ["cutting chai", "chai"], priceInPaise: 1_000, category: "Chai" },
    ];
    const amb = matchExistingItem("Chai", null, menu);
    expect(amb && "ambiguous" in amb ? amb.ambiguous.map((m) => m.id).sort() : amb).toEqual(["mi_chai", "mi_cut"]);
    expect(matchExistingItem("Chai", "mi_cut", menu)).toMatchObject({ item: { id: "mi_cut" } });
  });
});

describe("postProcessMenuDraft", () => {
  it("builds create rows with paise, emoji, aliases and spoken categories", () => {
    const d = post([
      { name: "Cutting Chai", priceRupees: 10, category: "Chai" },
      { name: "Mango Lassi", priceRupees: 60, category: "drinks", spokenAliases: ["Aam Lassi"] },
    ]);
    expect(d.model).toBe("haiku");
    expect(d.items).toEqual([
      expect.objectContaining({
        key: "new:cutting chai",
        name: "Cutting Chai",
        priceInPaise: 1_000,
        category: "Chai",
        emoji: "☕",
        action: "create",
        existingMenuItemId: null,
        existingPriceInPaise: null,
        priceSpoken: true,
      }),
      expect.objectContaining({
        name: "Mango Lassi",
        priceInPaise: 6_000,
        category: "Drinks",
        emoji: "🥛",
        aliases: expect.arrayContaining(["mango lassi", "lassi", "aam lassi"]),
      }),
    ]);
    expect(d.warnings).toEqual([]);
  });

  it("existing dish → update_price when the price differs, unchanged when it matches or is not said", () => {
    const d = post([
      { name: "Samosa", priceRupees: 25, category: "Snacks", existingMenuItemId: "mi_samosa" },
      { name: "Masala Chai", priceRupees: 15, category: "Chai" },
      { name: "Vada Pav", priceRupees: null, category: null },
    ]);
    expect(d.items.map((i) => [i.key, i.action, i.priceInPaise, i.existingPriceInPaise, i.priceSpoken])).toEqual([
      ["existing:mi_samosa", "update_price", 2_500, 2_000, true],
      ["existing:mi_chai", "unchanged", 1_500, 1_500, true],
      ["existing:mi_vada", "unchanged", 2_500, 2_500, false],
    ]);
    // Existing rows keep their own category / emoji / aliases.
    expect(d.items[2]).toMatchObject({ category: "Snacks", emoji: "🍔", aliases: ["vada pav", "vada", "pav"] });
    expect(d.warnings).toEqual([]);
  });

  it("flags fuzzy matches for review", () => {
    const d = post([{ name: "Samossa", priceRupees: 20, category: null }]);
    expect(d.items[0]).toMatchObject({ existingMenuItemId: "mi_samosa", action: "unchanged", matchedFuzzy: true });
    expect(d.warnings).toEqual(['"Samossa" matched to Samosa on your menu — please check']);
  });

  it("ignores a model id that points at a different dish or another tenant", () => {
    const d = post([
      { name: "Cutting Chai", priceRupees: 10, category: "Chai", existingMenuItemId: "mi_chai" },
      { name: "Kachori", priceRupees: 20, category: "Snacks", existingMenuItemId: "mi_other_vendor" },
    ]);
    expect(d.items.map((i) => [i.name, i.action, i.existingMenuItemId])).toEqual([
      ["Cutting Chai", "create", null],
      ["Kachori", "create", null],
    ]);
  });

  it("normalises categories to existing spellings (case, plural) and keeps one spelling per utterance", () => {
    const d = post([
      { name: "Kachori", priceRupees: 20, category: "SNACKS" },
      { name: "Bread Pakora", priceRupees: 25, category: "snack" },
      { name: "Lemon Soda", priceRupees: 30, category: "cold drinks" },
      { name: "Jaljeera", priceRupees: 20, category: "Cold Drinks mein" },
      { name: "Poha", priceRupees: 30, category: null },
    ]);
    expect(d.items.map((i) => i.category)).toEqual(["Snacks", "Snacks", "Cold Drinks", "Cold Drinks", "General"]);
  });

  it("reuses an existing 'general' spelling for the default category", () => {
    const menu = [{ id: "mi_x", name: "Thali", aliases: [], priceInPaise: 9_000, category: "general" }];
    expect(post([{ name: "Poha", priceRupees: 30, category: null }], menu).items[0]!.category).toBe("general");
  });

  it("missing / zero / absurd price → priceSpoken false, 0 for new, warning", () => {
    const d = post([
      { name: "Dabeli", priceRupees: null, category: "Snacks" },
      { name: "Khaman", priceRupees: 0, category: "Snacks" },
      { name: "Bun Maska", priceRupees: 2_000_000, category: "Snacks" },
      { name: "Samosa", priceRupees: -1, category: "Snacks" },
    ]);
    expect(d.items.map((i) => [i.name, i.priceInPaise, i.priceSpoken, i.action])).toEqual([
      ["Dabeli", 0, false, "create"],
      ["Khaman", 0, false, "create"],
      ["Bun Maska", 0, false, "create"],
      ["Samosa", 2_000, false, "unchanged"],
    ]);
    expect(d.warnings).toEqual([
      "Price for Khaman doesn't look right — please enter it",
      "Price for Bun Maska doesn't look right — please enter it",
      "Price for Samosa doesn't look right — please enter it",
      "No price heard for Dabeli — please enter it",
      "No price heard for Khaman — please enter it",
      "No price heard for Bun Maska — please enter it",
    ]);
  });

  it("dedupes a dish said twice: keeps the first position and the last spoken price", () => {
    const d = post([
      { name: "Kachori", priceRupees: 20, category: "Snacks" },
      { name: "Lassi", priceRupees: 40, category: "Drinks" },
      { name: "kachori", priceRupees: 25, category: null },
      { name: "Samosa", priceRupees: 25, category: null },
      { name: "samosa", priceRupees: null, category: null },
    ]);
    expect(d.items.map((i) => [i.name, i.priceInPaise, i.category, i.action])).toEqual([
      ["Kachori", 2_500, "Snacks", "create"],
      ["Lassi", 4_000, "Drinks", "create"],
      ["Samosa", 2_500, "Snacks", "update_price"],
    ]);
    expect(d.warnings).toEqual([
      "Kachori was said more than once — kept ₹25",
      "Samosa was said more than once — kept ₹25",
    ]);
  });

  it(`caps the draft at ${MENU_DRAFT_MAX_ITEMS} dishes`, () => {
    const items = Array.from({ length: 60 }, (_, i) => ({ name: `Dish ${i + 1}`, priceRupees: 10, category: "Snacks" }));
    const d = post(items);
    expect(d.items).toHaveLength(MENU_DRAFT_MAX_ITEMS);
    expect(d.items.at(-1)!.name).toBe("Dish 50");
    expect(d.warnings).toContain(`Only the first ${MENU_DRAFT_MAX_ITEMS} dishes were kept — add the rest in another go`);
  });

  it("nameless rows go to unparsed, model unparsed is kept, empty result warns", () => {
    const d = post([{ name: "  ", priceRupees: 20, category: null }, { name: "20", priceRupees: null, category: null }], MENU, [
      "baaki kal batata hoon",
    ]);
    expect(d.items).toEqual([]);
    expect(d.unparsed).toEqual(["20", "baaki kal batata hoon"]);
    expect(d.warnings).toEqual(["No dishes recognised — please try again or add them by hand"]);
  });

  it("every create row's price is integer paise (no floats leak)", () => {
    const d = post([{ name: "Kulhad Chai", priceRupees: 12.5, category: "Chai" }]);
    expect(d.items[0]!.priceInPaise).toBe(1_250);
    expect(Number.isInteger(d.items[0]!.priceInPaise)).toBe(true);
  });
});

describe("tool input schema", () => {
  it("coerces numeric strings and nulls; tolerates missing arrays", () => {
    const parsed = addMenuItemsInputSchema.parse({
      items: [{ name: "Chai", priceRupees: "₹15", category: null, spokenAliases: null, existingMenuItemId: "" }],
    });
    expect(parsed.items[0]).toEqual({ name: "Chai", priceRupees: 15, category: undefined, spokenAliases: [], existingMenuItemId: null });
    expect(parsed.unparsed).toEqual([]);
  });
});

describe("cached block", () => {
  it("is stableMenuJson + sorted distinct categories, independent of row order", () => {
    const a = menuBuilderCachedText(MENU);
    const b = menuBuilderCachedText([...MENU].reverse());
    expect(a).toBe(b);
    expect(existingCategories(MENU)).toEqual(["Chai", "Snacks"]);
    expect(a.endsWith('Existing categories (JSON):\n["Chai","Snacks"]')).toBe(true);
  });
});

describe("shouldEscalateMenu", () => {
  const raw = (items: Record<string, unknown>[]) => input(items);
  it("escalates on an empty result for a > 3-word transcript only", () => {
    expect(shouldEscalateMenu(raw([]), "chai samosa vada pav kachori")).toBe(true);
    expect(shouldEscalateMenu(raw([]), "chai samosa")).toBe(false);
  });
  it("escalates when most dishes lost their price although numbers were said", () => {
    const items = [
      { name: "Chai", priceRupees: null, category: null },
      { name: "Samosa", priceRupees: null, category: null },
      { name: "Kachori", priceRupees: 20, category: null },
    ];
    expect(shouldEscalateMenu(raw(items), "chai pandrah, samosa bees, kachori 20")).toBe(true);
    expect(shouldEscalateMenu(raw(items), "chai, samosa, kachori")).toBe(false);
    expect(shouldEscalateMenu(raw(items.slice(1)), "samosa bees, kachori 20")).toBe(false);
  });
});

describe("parseMenuFromTranscript (Haiku → Sonnet)", () => {
  function toolMessage(input: unknown) {
    return {
      id: "msg",
      type: "message",
      role: "assistant",
      model: "m",
      content: [{ type: "tool_use", id: "t", name: "add_menu_items", input }],
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    };
  }
  const clients = (haiku: ReturnType<typeof vi.fn>, sonnet: ReturnType<typeof vi.fn>) => ({
    haiku: { messages: { create: haiku } } as unknown as Anthropic,
    sonnet: { messages: { create: sonnet } } as unknown as Anthropic,
  });
  const GOOD = { items: [{ name: "Kachori", priceRupees: 20, category: "Snacks" }] };

  it("stays on Haiku for a good answer, passing the per-request timeout", async () => {
    const haiku = vi.fn().mockResolvedValue(toolMessage(GOOD));
    const sonnet = vi.fn();
    const out = await parseMenuFromTranscript({ menuItems: MENU, transcript: "kachori 20", lang: "hi-IN", clients: clients(haiku, sonnet) });
    expect(out).toMatchObject({ modelUsed: ANTHROPIC_PRIMARY_MODEL, escalated: false, draft: { model: "haiku" } });
    expect(haiku.mock.calls[0]![1]).toEqual({ timeout: 15_000, maxRetries: 1 });
    expect(sonnet).not.toHaveBeenCalled();
  });

  it("escalates on a Haiku throw / bad tool input, and on prices lost", async () => {
    const sonnet = vi.fn().mockResolvedValue(toolMessage(GOOD));
    const thrown = await parseMenuFromTranscript({
      menuItems: MENU,
      transcript: "kachori 20",
      lang: "hi-IN",
      clients: clients(vi.fn().mockRejectedValue(new Error("529")), sonnet),
    });
    expect(thrown).toMatchObject({ modelUsed: ANTHROPIC_FALLBACK_MODEL, escalated: true, draft: { model: "sonnet" } });
    expect(sonnet.mock.calls[0]![1]).toEqual({ timeout: 25_000, maxRetries: 0 });

    const noTool = await parseMenuFromTranscript({
      menuItems: MENU,
      transcript: "kachori 20",
      lang: "hi-IN",
      clients: clients(vi.fn().mockResolvedValue({ ...toolMessage(GOOD), content: [] }), sonnet),
    });
    expect(noTool.escalated).toBe(true);

    const lost = await parseMenuFromTranscript({
      menuItems: MENU,
      transcript: "kachori bees rupaye",
      lang: "hi-IN",
      clients: clients(vi.fn().mockResolvedValue(toolMessage({ items: [{ name: "Kachori", priceRupees: null, category: null }] })), sonnet),
    });
    expect(lost.draft.items[0]).toMatchObject({ priceInPaise: 2_000, priceSpoken: true });
  });

  it("keeps Haiku's answer when the escalation itself fails; throws when both tiers fail", async () => {
    const weak = toolMessage({ items: [{ name: "Kachori", priceRupees: null, category: null }] });
    const kept = await parseMenuFromTranscript({
      menuItems: MENU,
      transcript: "kachori bees",
      lang: "hi-IN",
      clients: clients(vi.fn().mockResolvedValue(weak), vi.fn().mockRejectedValue(new Error("down"))),
    });
    expect(kept).toMatchObject({ escalated: false, draft: { model: "haiku", items: [{ name: "Kachori", priceSpoken: false }] } });

    await expect(
      parseMenuFromTranscript({
        menuItems: MENU,
        transcript: "kachori bees",
        lang: "hi-IN",
        clients: clients(vi.fn().mockRejectedValue(new Error("a")), vi.fn().mockRejectedValue(new Error("b"))),
      }),
    ).rejects.toThrow("b");
  });
});
