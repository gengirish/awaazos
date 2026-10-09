/**
 * Wire-level request shape for the forced-tool Claude calls.
 *
 * Builds a real SDK client with a capturing `fetch`, runs parseOrderWithClaude,
 * buildDropWithClaude and buildMenuWithClaude, and compares the exact JSON body the SDK puts on the
 * wire against `fixtures/anthropic-request-bodies.json`. That fixture was
 * captured on SDK 0.39.0 (before the upgrade to 0.132; the parse-menu entries
 * were added later on 0.132), so an SDK upgrade that
 * changes the request (model ids, forced tool_choice, cache_control on the menu block,
 * system prompt, max_tokens/temperature, key order) fails here. The menu block
 * must stay byte-identical or the prompt cache misses on every call.
 *
 * Regenerate deliberately (only when a prompt/tool change is intended):
 *   UPDATE_ANTHROPIC_REQUEST_FIXTURE=1 npx vitest run lib/__tests__/anthropic-request-shape.test.ts
 *
 * No network: the fetch never leaves the process.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  requireEnv: vi.fn(() => "test-anthropic-key"),
  env: {} as Record<string, unknown>,
}));

import Anthropic from "@anthropic-ai/sdk";

import {
  ANTHROPIC_FALLBACK_MODEL,
  ANTHROPIC_PRIMARY_MODEL,
  anthropicHaiku,
  anthropicSonnet,
  parseOrderWithClaude,
  stableMenuJson,
  type MenuItemForParse,
} from "@/lib/anthropic";
import { buildDropWithClaude } from "@/lib/parse-drop";
import { buildMenuWithClaude, menuBuilderCachedText, type ExistingMenuItem } from "@/lib/parse-menu";

const FIXTURE_PATH = path.join(__dirname, "fixtures", "anthropic-request-bodies.json");
const UPDATE = process.env.UPDATE_ANTHROPIC_REQUEST_FIXTURE === "1";

// Deliberately unsorted ids/aliases/tags, slugs on some rows, non-ASCII text:
// exercises every ordering rule in stableMenuJson() and JSON escaping.
const MENU: MenuItemForParse[] = [
  { id: "mi_samosa", slug: "samosa", name: "Samosa", aliases: ["smosa", "samosaa"], tags: ["snacks", "hot"], priceInPaise: 1_500 },
  { id: "mi_chai", slug: null, name: "Masala Chai", aliases: ["chai", "चाय"], tags: [], priceInPaise: 1_000 },
  { id: "mi_bhel", name: "Bhel Puri", aliases: ["bhel", "lays bhel"], priceInPaise: 4_000 },
  { id: "mi_nimbu", slug: "nimbu-panna", name: "Nimbu Panna", aliases: ["nimbu pani", "lemonade"], tags: ["drinks", "cold", "seasonal"], priceInPaise: 2_500 },
];

/** Same rows with categories (one missing) for the menu builder's category list. */
const MENU_WITH_CATEGORIES: ExistingMenuItem[] = [
  { ...MENU[0]!, category: "Snacks", emoji: "🥟" },
  { ...MENU[1]!, category: "Chai", emoji: "☕" },
  { ...MENU[2]!, category: "Snacks" },
  { ...MENU[3]! },
];

/** Thu 8 Oct 2026, 15:30 IST — fixed so the drop user-turn text is deterministic. */
const NOW = new Date("2026-10-08T10:00:00.000Z");

type Captured = {
  method: string;
  path: string;
  anthropicVersion: string | null;
  anthropicBeta: string | null;
  body: string;
};

/** Compact re-serialisation that preserves key order and string bytes. */
const canonical = (body: string) => JSON.stringify(JSON.parse(body));

function toolMessage(model: string, name: string, input: Record<string, unknown>) {
  return {
    id: "msg_shape",
    type: "message",
    role: "assistant",
    model,
    content: [{ type: "tool_use", id: "toolu_shape", name, input }],
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  };
}

function capturingClient(reply: unknown): { client: Anthropic; calls: Captured[] } {
  const calls: Captured[] = [];
  const fetchImpl = async (url: unknown, init?: { method?: string; body?: unknown; headers?: unknown }) => {
    const headers = new Headers(init?.headers as HeadersInit);
    calls.push({
      method: String(init?.method),
      path: new URL(String(url)).pathname,
      anthropicVersion: headers.get("anthropic-version"),
      anthropicBeta: headers.get("anthropic-beta"),
      body: String(init?.body),
    });
    return new Response(JSON.stringify(reply), {
      status: 200,
      headers: { "content-type": "application/json", "request-id": "req_shape" },
    });
  };
  const client = new Anthropic({
    apiKey: "test-anthropic-key",
    maxRetries: 0,
    // Fetch's type differs between SDK majors; the runtime contract (url, init) does not.
    fetch: fetchImpl as never,
  });
  return { client, calls };
}

async function captureAll(): Promise<Record<string, Captured>> {
  const out: Record<string, Captured> = {};
  for (const [tier, model] of [
    ["haiku", ANTHROPIC_PRIMARY_MODEL],
    ["sonnet", ANTHROPIC_FALLBACK_MODEL],
  ] as const) {
    const order = capturingClient(
      toolMessage(model, "add_items", {
        items: [{ menuItemId: "mi_samosa", name: "Samosa", priceInPaise: 1_500, qty: 2 }],
        unmatched: [],
        confidence: "high",
      }),
    );
    await parseOrderWithClaude(order.client, model, MENU, "do samosa aur ek chai", "hi-IN");
    expect(order.calls).toHaveLength(1);
    out[`parse-order:${tier}`] = order.calls[0]!;

    const drop = capturingClient(
      toolMessage(model, "build_drop", {
        day: { kind: "tomorrow" },
        items: [{ menuItemId: "mi_samosa", spokenName: "samosa" }],
      }),
    );
    await buildDropWithClaude(
      drop.client,
      model,
      MENU,
      "kal shaam ko samosa ka drop, 50 piece",
      "hi-IN",
      NOW,
    );
    expect(drop.calls).toHaveLength(1);
    out[`parse-drop:${tier}`] = drop.calls[0]!;

    const menu = capturingClient(
      toolMessage(model, "add_menu_items", {
        items: [{ name: "Cutting Chai", priceRupees: 10, category: "Chai" }],
        unparsed: [],
      }),
    );
    await buildMenuWithClaude(
      menu.client,
      model,
      MENU_WITH_CATEGORIES,
      "cutting chai das rupaye, samosa bees, snacks mein",
      "hi-IN",
    );
    expect(menu.calls).toHaveLength(1);
    out[`parse-menu:${tier}`] = menu.calls[0]!;
  }
  return out;
}

describe("Anthropic request shape (wire body)", () => {
  it("matches the bodies captured on the previous SDK version", async () => {
    const captured = await captureAll();

    if (UPDATE || !existsSync(FIXTURE_PATH)) {
      if (!UPDATE) throw new Error(`Missing ${FIXTURE_PATH}; run with UPDATE_ANTHROPIC_REQUEST_FIXTURE=1`);
      mkdirSync(path.dirname(FIXTURE_PATH), { recursive: true });
      writeFileSync(FIXTURE_PATH, JSON.stringify(captured, null, 2) + "\n");
      return;
    }

    const expected = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Record<string, Captured>;
    expect(Object.keys(captured).sort()).toEqual(Object.keys(expected).sort());
    for (const key of Object.keys(expected)) {
      const got = captured[key]!;
      const want = expected[key]!;
      // Byte-identical after canonicalising insignificant whitespace: SDK 0.39
      // sent `JSON.stringify(body, null, 2)`, current SDKs send compact JSON.
      // The API parses the JSON, so inter-token whitespace is not part of the
      // prompt; every key, key order, value and string (incl. the cached menu
      // text) must still match exactly.
      expect(canonical(got.body), key).toBe(canonical(want.body));
      expect(got.method, key).toBe(want.method);
      expect(got.path, key).toBe(want.path);
      expect(got.anthropicVersion, key).toBe(want.anthropicVersion);
      expect(got.anthropicBeta, key).toBe(want.anthropicBeta);
    }
  });

  it("sends forced tool use, cached menu block first, uncached tail, same sampling", async () => {
    const captured = await captureAll();
    const menuText = `Authoritative menu (JSON):\n${stableMenuJson(MENU)}`;

    for (const [key, call] of Object.entries(captured)) {
      const body = JSON.parse(call.body) as {
        model: string;
        max_tokens: number;
        temperature: number;
        system: unknown;
        tools: { name: string }[];
        tool_choice: unknown;
        messages: { role: string; content: { type: string; text: string; cache_control?: unknown }[] }[];
      };
      const kind = key.split(":")[0] as "parse-order" | "parse-drop" | "parse-menu";
      const { toolName, maxTokens, cachedText } = {
        "parse-order": { toolName: "add_items", maxTokens: 512, cachedText: menuText },
        "parse-drop": { toolName: "build_drop", maxTokens: 1024, cachedText: menuText },
        "parse-menu": {
          toolName: "add_menu_items",
          maxTokens: 4096,
          cachedText: menuBuilderCachedText(MENU_WITH_CATEGORIES),
        },
      }[kind];

      expect(call.path).toBe("/v1/messages");
      expect(call.anthropicBeta).toBeNull();
      expect(body.model).toBe(key.endsWith("haiku") ? "claude-haiku-4-5" : "claude-sonnet-4-5");
      expect(body.max_tokens).toBe(maxTokens);
      expect(body.temperature).toBe(0.1);
      expect(typeof body.system).toBe("string");
      expect(body.tools.map((t) => t.name)).toEqual([toolName]);
      expect(body.tool_choice).toEqual({ type: "tool", name: toolName, disable_parallel_tool_use: true });
      expect(body.messages).toHaveLength(1);
      const [menuBlock, tail, ...rest] = body.messages[0]!.content;
      expect(rest).toEqual([]);
      expect(menuBlock).toEqual({ type: "text", text: cachedText, cache_control: { type: "ephemeral" } });
      // The menu JSON itself is the shared stableMenuJson() prefix on every path.
      expect(menuBlock!.text.startsWith(menuText)).toBe(true);
      expect(tail!.cache_control).toBeUndefined();
    }
  });
});

describe("Anthropic client singletons", () => {
  it("keep their per-tier timeout and retry budget", () => {
    expect(anthropicHaiku.timeout).toBe(8_000);
    expect(anthropicHaiku.maxRetries).toBe(2);
    expect(anthropicSonnet.timeout).toBe(15_000);
    expect(anthropicSonnet.maxRetries).toBe(2);
  });
});
