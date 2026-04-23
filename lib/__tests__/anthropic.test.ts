import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  requireEnv: vi.fn(() => "test-anthropic-key"),
  env: {} as Record<string, unknown>,
}));

import type Anthropic from "@anthropic-ai/sdk";

import {
  anthropicHaiku,
  ANTHROPIC_PRIMARY_MODEL,
  parseOrderWithClaude,
  type MenuItemForParse,
} from "@/lib/anthropic";

const FIXTURE_MENU: MenuItemForParse[] = [
  {
    id: "mi_bhel",
    name: "bhel",
    aliases: ["bhel", "lays bhel"],
    priceInPaise: 2000,
  },
  {
    id: "mi_nimbu",
    name: "nimbu pani",
    aliases: ["nimbu pani", "lemonade"],
    priceInPaise: 1500,
  },
  {
    id: "mi_samosa",
    name: "samosa",
    aliases: [],
    priceInPaise: 1000,
  },
  {
    id: "mi_vadapav",
    name: "vada pav",
    aliases: [],
    priceInPaise: 2500,
  },
  {
    id: "mi_chai",
    name: "chai",
    aliases: [],
    priceInPaise: 1000,
  },
];

function mockToolResponse(input: Record<string, unknown>) {
  return {
    id: "msg_test",
    type: "message" as const,
    role: "assistant" as const,
    model: ANTHROPIC_PRIMARY_MODEL,
    content: [
      {
        type: "tool_use" as const,
        id: "toolu_test",
        name: "add_items",
        input,
      },
    ],
    stop_reason: "tool_use" as const,
    usage: { input_tokens: 10, output_tokens: 20 },
  } as Anthropic.Messages.Message;
}

describe("parseOrderWithClaude", () => {
  const createSpy = vi.spyOn(anthropicHaiku.messages, "create");

  beforeEach(() => {
    createSpy.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('parses "do bhel aur ek nimbu pani" → 2× bhel, 1× nimbu pani', async () => {
    createSpy.mockResolvedValue(
      mockToolResponse({
        items: [
          { menuItemId: "mi_bhel", name: "bhel", priceInPaise: 2000, qty: 2 },
          { menuItemId: "mi_nimbu", name: "nimbu pani", priceInPaise: 1500, qty: 1 },
        ],
        unmatched: [],
        confidence: "high",
      }),
    );

    const r = await parseOrderWithClaude(
      anthropicHaiku,
      ANTHROPIC_PRIMARY_MODEL,
      FIXTURE_MENU,
      "do bhel aur ek nimbu pani",
      "hi-IN",
    );

    expect(r.items).toEqual([
      { menuItemId: "mi_bhel", name: "bhel", priceInPaise: 2000, qty: 2 },
      { menuItemId: "mi_nimbu", name: "nimbu pani", priceInPaise: 1500, qty: 1 },
    ]);
    expect(createSpy).toHaveBeenCalledTimes(1);
    const call = createSpy.mock.calls[0]![0] as Parameters<
      Anthropic["messages"]["create"]
    >[0];
    expect(call.tool_choice).toEqual({
      type: "tool",
      name: "add_items",
      disable_parallel_tool_use: true,
    });
    const userContent = call.messages[0]!.content;
    expect(Array.isArray(userContent)).toBe(true);
    const blocks = userContent as Anthropic.TextBlockParam[];
    const cached = blocks.find((b) => "cache_control" in b && b.cache_control);
    expect(cached).toBeDefined();
    expect(String(cached?.text)).toContain("Authoritative menu");
    const volatile = blocks.find((b) => !("cache_control" in b && b.cache_control));
    expect(String(volatile?.text)).toContain("do bhel aur ek nimbu pani");
  });

  it('parses "one small bhel and two lemonades" → 1× bhel, 2× nimbu pani', async () => {
    createSpy.mockResolvedValue(
      mockToolResponse({
        items: [
          { menuItemId: "mi_bhel", name: "bhel", priceInPaise: 2000, qty: 1 },
          { menuItemId: "mi_nimbu", name: "nimbu pani", priceInPaise: 1500, qty: 2 },
        ],
        unmatched: [],
        confidence: "high",
      }),
    );

    const r = await parseOrderWithClaude(
      anthropicHaiku,
      ANTHROPIC_PRIMARY_MODEL,
      FIXTURE_MENU,
      "one small bhel and two lemonades",
      "en-IN",
    );

    expect(r.items).toEqual([
      { menuItemId: "mi_bhel", name: "bhel", priceInPaise: 2000, qty: 1 },
      { menuItemId: "mi_nimbu", name: "nimbu pani", priceInPaise: 1500, qty: 2 },
    ]);
  });

  it('parses "rendu large bhel" → 2× bhel', async () => {
    createSpy.mockResolvedValue(
      mockToolResponse({
        items: [{ menuItemId: "mi_bhel", name: "bhel", priceInPaise: 2000, qty: 2 }],
        unmatched: [],
        confidence: "high",
      }),
    );

    const r = await parseOrderWithClaude(
      anthropicHaiku,
      ANTHROPIC_PRIMARY_MODEL,
      FIXTURE_MENU,
      "rendu large bhel",
      "te-IN",
    );

    expect(r.items).toEqual([{ menuItemId: "mi_bhel", name: "bhel", priceInPaise: 2000, qty: 2 }]);
  });

  it('parses "moodu samosa, okati chai" → 3× samosa, 1× chai', async () => {
    createSpy.mockResolvedValue(
      mockToolResponse({
        items: [
          { menuItemId: "mi_samosa", name: "samosa", priceInPaise: 1000, qty: 3 },
          { menuItemId: "mi_chai", name: "chai", priceInPaise: 1000, qty: 1 },
        ],
        unmatched: [],
        confidence: "high",
      }),
    );

    const r = await parseOrderWithClaude(
      anthropicHaiku,
      ANTHROPIC_PRIMARY_MODEL,
      FIXTURE_MENU,
      "moodu samosa, okati chai",
      "te-IN",
    );

    expect(r.items).toEqual([
      { menuItemId: "mi_samosa", name: "samosa", priceInPaise: 1000, qty: 3 },
      { menuItemId: "mi_chai", name: "chai", priceInPaise: 1000, qty: 1 },
    ]);
  });

  it('parses "ek vada pav" → 1× vada pav', async () => {
    createSpy.mockResolvedValue(
      mockToolResponse({
        items: [{ menuItemId: "mi_vadapav", name: "vada pav", priceInPaise: 2500, qty: 1 }],
        unmatched: [],
        confidence: "high",
      }),
    );

    const r = await parseOrderWithClaude(
      anthropicHaiku,
      ANTHROPIC_PRIMARY_MODEL,
      FIXTURE_MENU,
      "ek vada pav",
      "hi-IN",
    );

    expect(r.items).toEqual([
      { menuItemId: "mi_vadapav", name: "vada pav", priceInPaise: 2500, qty: 1 },
    ]);
  });

  it('parses "scooty chahiye" → empty items, unmatched ["scooty"]', async () => {
    createSpy.mockResolvedValue(
      mockToolResponse({
        items: [],
        unmatched: ["scooty"],
        confidence: "high",
      }),
    );

    const r = await parseOrderWithClaude(
      anthropicHaiku,
      ANTHROPIC_PRIMARY_MODEL,
      FIXTURE_MENU,
      "scooty chahiye",
      "hi-IN",
    );

    expect(r.items).toEqual([]);
    expect(r.unmatched).toEqual(["scooty"]);
  });
});
