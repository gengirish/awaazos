import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  requireEnv: vi.fn(() => "test-anthropic-key"),
  env: {} as Record<string, unknown>,
}));

import type Anthropic from "@anthropic-ai/sdk";

import { ANTHROPIC_FALLBACK_MODEL, ANTHROPIC_PRIMARY_MODEL, type MenuItemForParse } from "@/lib/anthropic";
import {
  buildDropInputSchema,
  normaliseHm,
  parseDropFromTranscript,
  postProcessDropDraft,
  resolveDayRef,
  shouldEscalateDrop,
  type BuildDropToolInput,
} from "@/lib/parse-drop";

const MENU: MenuItemForParse[] = [
  { id: "mi_laddu", name: "Ragi Laddu", aliases: ["ragi ladoo", "laddu"], priceInPaise: 12_000 },
  { id: "mi_thepla", name: "Methi Thepla", aliases: ["thepla"], priceInPaise: 8_000 },
  { id: "mi_bread", name: "Banana Bread", aliases: ["banana cake"], priceInPaise: 25_000 },
  { id: "mi_chakli", name: "Chakli", aliases: ["murukku"], priceInPaise: 6_000 },
];

/** Thu 8 Oct 2026, 15:30 IST. */
const NOW = new Date("2026-10-08T10:00:00.000Z");

const input = (v: Record<string, unknown>): BuildDropToolInput => buildDropInputSchema.parse(v);
const post = (v: Record<string, unknown>, now = NOW) => postProcessDropDraft(input(v), MENU, now, "haiku");

describe("resolveDayRef (IST)", () => {
  it("resolves relative days from the IST calendar day", () => {
    expect(resolveDayRef({ kind: "today" }, "2026-10-08")).toBe("2026-10-08");
    expect(resolveDayRef({ kind: "tomorrow" }, "2026-10-08")).toBe("2026-10-09");
    expect(resolveDayRef({ kind: "day_after_tomorrow" }, "2026-10-31")).toBe("2026-11-02");
  });

  it("resolves weekdays to the next occurrence (today counts)", () => {
    expect(resolveDayRef({ kind: "weekday", weekday: "saturday" }, "2026-10-08")).toBe("2026-10-10");
    expect(resolveDayRef({ kind: "weekday", weekday: "thursday" }, "2026-10-08")).toBe("2026-10-08");
    expect(resolveDayRef({ kind: "weekday", weekday: "wednesday" }, "2026-10-08")).toBe("2026-10-14");
  });

  it("rejects impossible explicit dates and resolves fulfilment-relative days", () => {
    expect(resolveDayRef({ kind: "date", date: "2026-02-30" }, "2026-10-08")).toBeNull();
    expect(resolveDayRef({ kind: "date", date: "2026-10-12" }, "2026-10-08")).toBe("2026-10-12");
    expect(resolveDayRef({ kind: "day_before_fulfilment" }, "2026-10-08", "2026-10-10")).toBe("2026-10-09");
    expect(resolveDayRef({ kind: "fulfilment_day" }, "2026-10-08")).toBeNull();
  });

  it("'today' flips at IST midnight, not UTC midnight", () => {
    const beforeMidnight = new Date("2026-10-08T18:15:00.000Z"); // 23:45 IST Thu
    const afterMidnight = new Date("2026-10-08T18:45:00.000Z"); // 00:15 IST Fri
    const items = [{ menuItemId: "mi_laddu", spokenName: "laddu" }];
    expect(post({ day: { kind: "today" }, items }, beforeMidnight).date).toBe("2026-10-08");
    expect(post({ day: { kind: "today" }, items }, afterMidnight).date).toBe("2026-10-09");
    expect(post({ day: { kind: "tomorrow" }, items }, afterMidnight).date).toBe("2026-10-10");
  });
});

describe("normaliseHm", () => {
  it("pads and validates", () => {
    expect(normaliseHm("6:30")).toBe("06:30");
    expect(normaliseHm("18")).toBe("18:00");
    expect(normaliseHm("18.45")).toBe("18:45");
    expect(normaliseHm("25:00")).toBeNull();
    expect(normaliseHm("shaam")).toBeNull();
    expect(normaliseHm(undefined)).toBeNull();
  });
});

describe("postProcessDropDraft", () => {
  it("builds the headline example: today, pickup 6–8 pm, cut-off 4 pm, price override", () => {
    const d = post({
      day: { kind: "today" },
      fulfilmentMode: "PICKUP",
      windowStart: "18:00",
      windowEnd: "20:00",
      cutoffTime: "16:00",
      items: [
        { menuItemId: "mi_laddu", spokenName: "ragi laddu", quantity: 20, priceRupees: 150 },
        { menuItemId: "mi_thepla", spokenName: "thepla", quantity: 15 },
        { menuItemId: "mi_bread", spokenName: "banana bread", quantity: 10 },
      ],
    });
    expect(d).toMatchObject({
      date: "2026-10-08",
      fulfilmentMode: "PICKUP",
      fulfilmentStart: "18:00",
      fulfilmentEnd: "20:00",
      closesAtDate: "2026-10-08",
      closesAtTime: "16:00",
      deliveryFeePaise: 0,
      showEverydayMenu: false,
      model: "haiku",
    });
    expect(d.items).toEqual([
      { menuItemId: "mi_laddu", name: "Ragi Laddu", priceInPaise: 15_000, maxQty: 20, perOrderLimit: null, sortOrder: 0 },
      { menuItemId: "mi_thepla", name: "Methi Thepla", priceInPaise: 8_000, maxQty: 15, perOrderLimit: null, sortOrder: 1 },
      { menuItemId: "mi_bread", name: "Banana Bread", priceInPaise: 25_000, maxQty: 10, perOrderLimit: null, sortOrder: 2 },
    ]);
    expect(d.unmatched).toEqual([]);
    expect(d.warnings).toEqual([]);
    expect(d.filled).toEqual(
      expect.arrayContaining(["date", "fulfilmentMode", "fulfilmentStart", "fulfilmentEnd", "closesAtTime", "items"]),
    );
    expect(d.filled).not.toContain("closesAtDate");
    expect(d.filled).not.toContain("title");
  });

  it("converts rupees to paise exactly (dedh sau = 150, 99.5, 2.5 decimals rejected)", () => {
    const d = post({
      items: [
        { menuItemId: "mi_laddu", spokenName: "laddu", priceRupees: 99.5 },
        { menuItemId: "mi_thepla", spokenName: "thepla", priceRupees: 12.345 },
        { menuItemId: "mi_bread", spokenName: "bread", priceRupees: "150" },
      ],
      deliveryFeeRupees: 30,
      fulfilmentMode: "DELIVERY",
    });
    expect(d.items.map((i) => i.priceInPaise)).toEqual([9_950, 8_000, 15_000]);
    expect(d.deliveryFeePaise).toBe(3_000);
    expect(d.warnings).toContain("Couldn't understand the price for Methi Thepla — used the menu price");
  });

  it("drops unknown menuItemIds into unmatched (no forged ids)", () => {
    const d = post({
      items: [
        { menuItemId: "mi_other_vendor", spokenName: "gulab jamun", quantity: 12 },
        { menuItemId: null, spokenName: "kaju katli" },
        { menuItemId: "mi_laddu", spokenName: "laddu", quantity: 5 },
      ],
    });
    expect(d.items.map((i) => i.menuItemId)).toEqual(["mi_laddu"]);
    expect(d.unmatched).toEqual([{ spokenName: "gulab jamun", quantity: 12 }, { spokenName: "kaju katli" }]);
  });

  it("rescues a null id by string match on menu name/aliases and flags it", () => {
    const d = post({ items: [{ menuItemId: null, spokenName: "murukku", quantity: 30 }] });
    expect(d.items).toEqual([
      expect.objectContaining({ menuItemId: "mi_chakli", maxQty: 30, matchedByName: true, priceInPaise: 6_000 }),
    ]);
    expect(d.warnings).toContain('"murukku" matched to Chakli — please check');
  });

  it("clamps quantities and per-order limits", () => {
    const d = post({
      items: [
        { menuItemId: "mi_laddu", spokenName: "laddu", quantity: 50_000 },
        { menuItemId: "mi_thepla", spokenName: "thepla", quantity: 4, perOrderLimit: 6 },
        { menuItemId: "mi_bread", spokenName: "bread", quantity: 0, perOrderLimit: 5_000 },
      ],
    });
    expect(d.items.map((i) => [i.maxQty, i.perOrderLimit])).toEqual([
      [10_000, null],
      [4, 4],
      [null, 1_000],
    ]);
    expect(d.warnings).toContain("Quantity for Ragi Laddu capped at 10000");
  });

  it("keeps the first of duplicate items", () => {
    const d = post({
      items: [
        { menuItemId: "mi_laddu", spokenName: "laddu", quantity: 5 },
        { menuItemId: "mi_laddu", spokenName: "ragi laddu", quantity: 9 },
      ],
    });
    expect(d.items).toHaveLength(1);
    expect(d.items[0]!.maxQty).toBe(5);
    expect(d.warnings).toContain("Ragi Laddu was mentioned twice — kept the first one");
  });

  it("reads 'shaam 6 se 8' heard as 18:00–08:00 as 6–8 pm", () => {
    const d = post({
      day: { kind: "tomorrow" },
      windowStart: "18:00",
      windowEnd: "08:00",
      items: [{ menuItemId: "mi_laddu", spokenName: "laddu" }],
    });
    expect(d.fulfilmentStart).toBe("18:00");
    expect(d.fulfilmentEnd).toBe("20:00");
    expect(d.warnings).toContain("Assumed pickup ends at 8:00 pm — please check");
  });

  it("warns when the cut-off is after the window starts", () => {
    const d = post({
      day: { kind: "tomorrow" },
      windowStart: "12:00",
      windowEnd: "14:00",
      cutoffDay: { kind: "fulfilment_day" },
      cutoffTime: "13:00",
      items: [{ menuItemId: "mi_laddu", spokenName: "laddu" }],
    });
    expect(d.closesAtDate).toBe("2026-10-09");
    expect(d.closesAtTime).toBe("13:00");
    expect(d.warnings).toContain("Cut-off is after pickup starts — please check");
    // The schema's own wording for the same problem is not repeated.
    expect(d.warnings).not.toContain("Orders must close before delivery/pickup starts");
  });

  it("a cut-off time later than the window start lands on the evening before", () => {
    const d = post({
      day: { kind: "weekday", weekday: "saturday" },
      windowStart: "11:00",
      windowEnd: "13:00",
      cutoffTime: "21:00",
      items: [{ menuItemId: "mi_laddu", spokenName: "laddu" }],
    });
    expect(d.date).toBe("2026-10-10");
    expect(d).toMatchObject({ closesAtDate: "2026-10-09", closesAtTime: "21:00" });
    expect(d.warnings).toEqual([]);
  });

  it("warns when the cut-off has already passed", () => {
    const d = post({
      day: { kind: "today" },
      windowStart: "18:00",
      windowEnd: "20:00",
      cutoffTime: "12:00",
      items: [{ menuItemId: "mi_laddu", spokenName: "laddu" }],
    });
    expect(d.warnings).toContain("The order cut-off has already passed — please move it later");
  });

  it("fills form defaults when nothing but items is said", () => {
    const d = post({ items: [{ menuItemId: "mi_laddu", spokenName: "laddu", quantity: 10 }] });
    expect(d).toMatchObject({
      date: "2026-10-09",
      fulfilmentMode: "PICKUP",
      fulfilmentStart: "17:00",
      fulfilmentEnd: "20:00",
      // defaultCutoffFor: the evening before, 21:00 (it's 15:30 on that evening)
      closesAtDate: "2026-10-08",
      closesAtTime: "21:00",
      deliveryFeePaise: 0,
      showEverydayMenu: false,
    });
    expect(d.title).toBeUndefined();
    expect(d.opensAtDate).toBeUndefined();
    expect(d.filled).toEqual(["items"]);
    expect(d.warnings).toEqual([]);
  });

  it("a spoken delivery fee implies delivery; a pickup fee is dropped with a warning", () => {
    const implied = post({ deliveryFeeRupees: 40, items: [{ menuItemId: "mi_laddu", spokenName: "laddu" }] });
    expect(implied.fulfilmentMode).toBe("DELIVERY");
    expect(implied.deliveryFeePaise).toBe(4_000);
    expect(implied.filled).toContain("deliveryFeePaise");

    const pickup = post({
      fulfilmentMode: "PICKUP",
      deliveryFeeRupees: 40,
      items: [{ menuItemId: "mi_laddu", spokenName: "laddu" }],
    });
    expect(pickup.deliveryFeePaise).toBe(0);
    expect(pickup.warnings).toContain("A delivery fee was mentioned for a pickup-only drop — it was left out");
  });

  it("defaults the window end to start + 3h when only the start is said", () => {
    const d = post({ windowStart: "16:30", items: [{ menuItemId: "mi_laddu", spokenName: "laddu" }] });
    expect(d.fulfilmentStart).toBe("16:30");
    expect(d.fulfilmentEnd).toBe("19:30");
    expect(d.filled).toContain("fulfilmentStart");
    expect(d.filled).not.toContain("fulfilmentEnd");
  });

  it("opens-at needs a time; title/notes are trimmed and capped", () => {
    const d = post({
      title: `  ${"Diwali special ".repeat(10)}`,
      opensDay: { kind: "today" },
      opensTime: "19:00",
      showEverydayMenu: true,
      items: [{ menuItemId: "mi_laddu", spokenName: "laddu" }],
    });
    expect(d.title!.length).toBeLessThanOrEqual(80);
    expect(d).toMatchObject({ opensAtDate: "2026-10-08", opensAtTime: "19:00", showEverydayMenu: true });
    expect(d.filled).toEqual(expect.arrayContaining(["title", "opensAtDate", "opensAtTime", "showEverydayMenu"]));
  });

  it("warns (doesn't fail) on an empty cart and bad times", () => {
    const d = post({ windowStart: "shaam", items: [{ menuItemId: null, spokenName: "xyzzy pqrs" }] });
    expect(d.items).toEqual([]);
    expect(d.unmatched).toEqual([{ spokenName: "xyzzy pqrs" }]);
    expect(d.fulfilmentStart).toBe("17:00");
    expect(d.warnings).toEqual(
      expect.arrayContaining([
        "No menu items recognised — please pick items below",
        "Couldn't understand the pickup start time — please check",
      ]),
    );
  });
});

describe("shouldEscalateDrop", () => {
  it("escalates on an empty cart for a >3-word transcript, or mostly-unknown items", () => {
    expect(shouldEscalateDrop(input({ items: [] }), "aaj ke liye kuch banaungi", MENU)).toBe(true);
    expect(shouldEscalateDrop(input({ items: [] }), "hello", MENU)).toBe(false);
    expect(
      shouldEscalateDrop(
        input({ items: [{ menuItemId: null, spokenName: "a" }, { menuItemId: "mi_laddu", spokenName: "b" }] }),
        "x",
        MENU,
      ),
    ).toBe(true);
    expect(
      shouldEscalateDrop(
        input({
          items: [
            { menuItemId: "bogus", spokenName: "a" },
            { menuItemId: "mi_laddu", spokenName: "b" },
            { menuItemId: "mi_thepla", spokenName: "c" },
          ],
        }),
        "x",
        MENU,
      ),
    ).toBe(false);
  });
});

// ─── Pipeline with a mocked Anthropic client ────────────────────────────────

function toolMessage(toolInput: unknown, name = "build_drop") {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "test",
    content: [{ type: "tool_use", id: "toolu_test", name, input: toolInput }],
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

function fakeClient(impl: () => unknown) {
  const create = vi.fn(async (_params: unknown) => impl());
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

const GOOD = {
  day: { kind: "today" },
  windowStart: "18:00",
  windowEnd: "20:00",
  cutoffTime: "16:00",
  items: [{ menuItemId: "mi_laddu", spokenName: "ragi laddu", quantity: 20, priceRupees: 150 }],
};

describe("parseDropFromTranscript", () => {
  const transcript = "aaj ke liye 20 ragi laddu 150 rupaye, pickup shaam 6 se 8, order 4 baje tak";

  it("calls Haiku with the forced tool, cached menu block first and today's IST date after it", async () => {
    const haiku = fakeClient(() => toolMessage(GOOD));
    const sonnet = fakeClient(() => toolMessage(GOOD));
    const out = await parseDropFromTranscript({
      menuItems: MENU,
      transcript,
      lang: "hi-IN",
      now: NOW,
      clients: { haiku: haiku.client, sonnet: sonnet.client },
    });
    expect(out.escalated).toBe(false);
    expect(out.modelUsed).toBe(ANTHROPIC_PRIMARY_MODEL);
    expect(out.draft.model).toBe("haiku");
    expect(out.draft.items[0]!.priceInPaise).toBe(15_000);
    expect(sonnet.create).not.toHaveBeenCalled();

    const req = haiku.create.mock.calls[0]![0] as unknown as Anthropic.MessageCreateParamsNonStreaming;
    expect(req.model).toBe(ANTHROPIC_PRIMARY_MODEL);
    expect(req.tool_choice).toMatchObject({ type: "tool", name: "build_drop" });
    expect(req.tools?.map((t) => (t as Anthropic.Tool).name)).toEqual(["build_drop"]);
    expect(typeof req.system).toBe("string");
    expect(req.system as string).not.toMatch(/2026/); // date stays out of the cached system prompt
    const content = req.messages[0]!.content as Anthropic.TextBlockParam[];
    expect(content[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect(content[0]!.text).toContain('"id":"mi_bread"');
    expect(content[0]!.text).not.toContain("2026-10-08");
    expect(content[1]!.cache_control).toBeUndefined();
    expect(content[1]!.text).toContain("Thursday 2026-10-08, time now 15:30");
    expect(content[1]!.text).toContain(transcript);
  });

  it("menu block is byte-identical regardless of row order (prompt cache stays warm)", async () => {
    const a = fakeClient(() => toolMessage(GOOD));
    const b = fakeClient(() => toolMessage(GOOD));
    const run = (client: Anthropic, menu: MenuItemForParse[]) =>
      parseDropFromTranscript({ menuItems: menu, transcript, lang: "hi-IN", now: NOW, clients: { haiku: client, sonnet: client } });
    await run(a.client, MENU);
    await run(b.client, [...MENU].reverse());
    const block = (c: typeof a) =>
      ((c.create.mock.calls[0]![0] as unknown as Anthropic.MessageCreateParamsNonStreaming).messages[0]!
        .content as Anthropic.TextBlockParam[])[0]!.text;
    expect(block(a)).toBe(block(b));
  });

  it("escalates to Sonnet when Haiku throws", async () => {
    const haiku = fakeClient(() => {
      throw new Error("overloaded");
    });
    const sonnet = fakeClient(() => toolMessage(GOOD));
    const out = await parseDropFromTranscript({
      menuItems: MENU,
      transcript,
      lang: "hi-IN",
      now: NOW,
      clients: { haiku: haiku.client, sonnet: sonnet.client },
    });
    expect(out).toMatchObject({ escalated: true, modelUsed: ANTHROPIC_FALLBACK_MODEL });
    expect(out.draft.model).toBe("sonnet");
    expect((sonnet.create.mock.calls[0]![0] as unknown as { model: string }).model).toBe(ANTHROPIC_FALLBACK_MODEL);
  });

  it("escalates when Haiku returns no tool_use block", async () => {
    const haiku = fakeClient(() => toolMessage(GOOD, "add_items"));
    const sonnet = fakeClient(() => toolMessage(GOOD));
    const out = await parseDropFromTranscript({
      menuItems: MENU,
      transcript,
      lang: "hi-IN",
      now: NOW,
      clients: { haiku: haiku.client, sonnet: sonnet.client },
    });
    expect(out.escalated).toBe(true);
  });

  it("escalates on an empty Haiku cart and keeps Haiku's draft if Sonnet then fails", async () => {
    const haiku = fakeClient(() => toolMessage({ ...GOOD, items: [] }));
    const sonnet = fakeClient(() => {
      throw new Error("timeout");
    });
    const out = await parseDropFromTranscript({
      menuItems: MENU,
      transcript,
      lang: "hi-IN",
      now: NOW,
      clients: { haiku: haiku.client, sonnet: sonnet.client },
    });
    expect(sonnet.create).toHaveBeenCalledTimes(1);
    expect(out.escalated).toBe(false);
    expect(out.draft.model).toBe("haiku");
    expect(out.draft.items).toEqual([]);
  });

  it("throws when both tiers fail", async () => {
    const boom = () => {
      throw new Error("down");
    };
    await expect(
      parseDropFromTranscript({
        menuItems: MENU,
        transcript,
        lang: "hi-IN",
        now: NOW,
        clients: { haiku: fakeClient(boom).client, sonnet: fakeClient(boom).client },
      }),
    ).rejects.toThrow("down");
  });
});
