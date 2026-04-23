import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import { requireEnv } from "@/lib/env";

export const ANTHROPIC_PRIMARY_MODEL =
  process.env.ANTHROPIC_PRIMARY_MODEL ?? "claude-haiku-4-5";
export const ANTHROPIC_FALLBACK_MODEL =
  process.env.ANTHROPIC_FALLBACK_MODEL ?? "claude-sonnet-4-5";

const ORDER_PARSE_SYSTEM = `You parse Indian-vendor voice orders into structured data for a billing POS.
Use the add_items tool exactly once. Match items by name OR aliases (case-insensitive).
Default qty = 1 when not specified.

Normalize Indic numerals:
- hi: ek=1, do=2, teen=3, char=4, paanch=5
- te: okati=1, rendu=2, moodu=3, naalugu=4, aidu=5
- kn: ondu=1, eradu=2, mooru=3, naalku=4, aidu=5
- ta: onnu=1, rendu=2, moonu=3, naangu=4, anju=5

Put any phrase you could NOT confidently map into unmatched.
confidence = low if unmatched.length > 0 OR the transcript is ambiguous.
Return items: [] if nothing matches.

The authoritative menu JSON is provided in a separate user message block (cached).`;

export const ADD_ITEMS_TOOL: Anthropic.Tool = {
  name: "add_items",
  description:
    "Add billable items detected in the customer's voice order to the cart.",
  input_schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            menuItemId: { type: "string" },
            name: { type: "string" },
            priceInPaise: { type: "integer" },
            qty: { type: "integer", minimum: 1 },
          },
          required: ["menuItemId", "name", "priceInPaise", "qty"],
        },
      },
      unmatched: { type: "array", items: { type: "string" } },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
    },
    required: ["items", "unmatched", "confidence"],
  },
};

const addItemsResultSchema = z.object({
  items: z.array(
    z.object({
      menuItemId: z.string(),
      name: z.string(),
      priceInPaise: z.number().int(),
      qty: z.number().int().min(1),
    }),
  ),
  unmatched: z.array(z.string()),
  confidence: z.enum(["high", "medium", "low"]),
});

export type MenuItemForParse = {
  id: string;
  name: string;
  aliases: string[];
  priceInPaise: number;
};

export type ParseOrderResult = {
  items: z.infer<typeof addItemsResultSchema>["items"];
  unmatched: string[];
  confidence: "high" | "medium" | "low";
  raw: unknown;
};

/**
 * Anthropic SDK clients. Per-request timeouts:
 *  - Haiku: 8s (fast model, voice latency budget is ~3s p95)
 *  - Sonnet: 15s (escalation tier; allowed slower for accuracy)
 * SDK auto-retries 2x with exponential backoff on transient 5xx / network
 * errors. Combined upper-bound: ~30s — caller (route handler) should not
 * wait longer than that or the Vercel function timeout fires anyway.
 */
const ANTHROPIC_HAIKU_TIMEOUT_MS = 8_000;
const ANTHROPIC_SONNET_TIMEOUT_MS = 15_000;
const ANTHROPIC_MAX_RETRIES = 2;

function getAnthropicHaikuInner(): Anthropic {
  return new Anthropic({
    apiKey: requireEnv("ANTHROPIC_API_KEY"),
    timeout: ANTHROPIC_HAIKU_TIMEOUT_MS,
    maxRetries: ANTHROPIC_MAX_RETRIES,
  });
}

function getAnthropicSonnetInner(): Anthropic {
  return new Anthropic({
    apiKey: requireEnv("ANTHROPIC_API_KEY"),
    timeout: ANTHROPIC_SONNET_TIMEOUT_MS,
    maxRetries: ANTHROPIC_MAX_RETRIES,
  });
}

let _haiku: Anthropic | null = null;
let _sonnet: Anthropic | null = null;

/** Lazy singleton for Haiku-tier calls (same API key; model id passed per request). */
export const anthropicHaiku = new Proxy({} as Anthropic, {
  get(_target, prop) {
    if (!_haiku) _haiku = getAnthropicHaikuInner();
    const v = Reflect.get(_haiku, prop, _haiku);
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(_haiku) : v;
  },
});

/** Lazy singleton for Sonnet-tier calls. */
export const anthropicSonnet = new Proxy({} as Anthropic, {
  get(_target, prop) {
    if (!_sonnet) _sonnet = getAnthropicSonnetInner();
    const v = Reflect.get(_sonnet, prop, _sonnet);
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(_sonnet) : v;
  },
});

function stableMenuJson(menuItems: MenuItemForParse[]): string {
  const normalized = [...menuItems]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((m) => ({
      id: m.id,
      name: m.name,
      aliases: [...m.aliases].sort((x, y) => x.localeCompare(y)),
      priceInPaise: m.priceInPaise,
    }));
  return JSON.stringify(normalized);
}

function extractToolUseInput(
  message: Anthropic.Messages.Message,
): unknown {
  for (const block of message.content) {
    if (block.type === "tool_use" && block.name === "add_items") {
      return block.input;
    }
  }
  throw new Error("No add_items tool_use in response");
}

/**
 * Calls Claude with forced add_items tool-use. Menu JSON is cached (ephemeral);
 * transcript is in a later non-cached block.
 */
export async function parseOrderWithClaude(
  modelClient: Anthropic,
  modelName: string,
  menuItems: MenuItemForParse[],
  transcript: string,
  lang: string,
): Promise<ParseOrderResult> {
  const menuJson = stableMenuJson(menuItems);

  const message = await modelClient.messages.create({
    model: modelName,
    max_tokens: 512,
    temperature: 0.1,
    system: ORDER_PARSE_SYSTEM,
    tools: [ADD_ITEMS_TOOL],
    tool_choice: { type: "tool", name: "add_items", disable_parallel_tool_use: true },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Authoritative menu (JSON):\n${menuJson}`,
            cache_control: { type: "ephemeral" },
          },
          {
            type: "text",
            text: `Customer transcript (${lang}):\n${transcript}`,
          },
        ],
      },
    ],
  });

  const rawInput = extractToolUseInput(message);
  const parsed = addItemsResultSchema.parse(rawInput);
  return {
    items: parsed.items,
    unmatched: parsed.unmatched,
    confidence: parsed.confidence,
    raw: rawInput,
  };
}
