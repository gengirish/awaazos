---
name: awaazos-claude-pipeline
description: Build the AwaazOS voice → Claude → cart pipeline. Use when implementing /api/ai/parse-order, /api/ai/transcribe, lib/anthropic.ts, lib/sarvam.ts, hooks/useVoiceOrder.ts, or workers/voiceLog.worker.ts. Covers two-tier Haiku/Sonnet routing, Anthropic tool-use, ephemeral prompt caching, Indic numeral normalization, and the Sarvam STT plumbing.
---

# AwaazOS Voice Pipeline

This is the project's core differentiator. Read these in order before writing
any voice/AI code.

## 1. Project rules (ALWAYS read first)

- `.cursor/rules/voice-ai.mdc` — STT routing, tool-use mandate, performance
  budget, PII guardrail, Vitest fixtures
- `.cursor/rules/security-first.mdc` — what NEVER goes to the LLM
- `.cursor/rules/india-locale.mdc` — paise integer discipline

## 2. Anthropic SDK patterns (read the relevant ones, not all)

The official Anthropic skill lives outside this repo. Use the **TypeScript**
subset. Read these absolute paths via the Read tool:

| Topic | Path |
|---|---|
| Tool use (CRITICAL — we use `add_items` tool) | `C:\Users\gengi\Documents\skills\skills\claude-api\typescript\claude-api\tool-use.md` |
| Streaming responses | `C:\Users\gengi\Documents\skills\skills\claude-api\typescript\claude-api\streaming.md` |
| Tool-use concepts (language-agnostic) | `C:\Users\gengi\Documents\skills\skills\claude-api\shared\tool-use-concepts.md` |
| Prompt caching (`cache_control: ephemeral`) | `C:\Users\gengi\Documents\skills\skills\claude-api\shared\prompt-caching.md` |
| Model IDs + capabilities | `C:\Users\gengi\Documents\skills\skills\claude-api\shared\models.md` |

NEVER guess SDK shape. If you need a method not shown above, WebFetch the
Anthropic docs first.

## 3. Two-tier model strategy

```
PRIMARY:  process.env.ANTHROPIC_PRIMARY_MODEL   (default 'claude-haiku-4-5')
FALLBACK: process.env.ANTHROPIC_FALLBACK_MODEL  (default 'claude-sonnet-4-5')
```

Centralize model IDs in `lib/anthropic.ts` constants, NOT scattered through
the codebase. Anthropic renames slugs — one place to update.

Escalate from Haiku → Sonnet ONLY if:
- (a) zod validation fails OR `JSON.parse` throws
- (b) `items === []` AND `transcript.split(/\s+/).length > 3`
- (c) `confidence === 'low'` AND `unmatched.length > 0`

## 4. The `add_items` tool

Use Anthropic tool-use, NOT free-form JSON parsing:

```ts
const ADD_ITEMS_TOOL: Anthropic.Tool = {
  name: "add_items",
  description: "Add billable items detected in the customer's voice order to the cart.",
  input_schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            menuItemId:   { type: "string" },
            name:         { type: "string" },
            priceInPaise: { type: "integer" },
            qty:          { type: "integer", minimum: 1 },
          },
          required: ["menuItemId", "name", "priceInPaise", "qty"],
        },
      },
      unmatched:  { type: "array", items: { type: "string" } },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
    },
    required: ["items", "unmatched", "confidence"],
  },
};
```

Force tool use with `tool_choice: { type: "tool", name: "add_items" }`.

## 5. Prompt caching

Wrap the menu (the expensive, repeated input) — NOT the system prompt header,
NOT the user transcript:

```ts
{
  role: "user",
  content: [
    { type: "text", text: "Customer transcript: " + transcript },
    {
      type: "text",
      text: "Authoritative menu (JSON): " + JSON.stringify(menu),
      cache_control: { type: "ephemeral" },   // 5-min TTL
    },
  ],
}
```

Optional cache warmer: every 4 minutes while POS is open and
`vendor.plan ≥ STARTER`, fire a 1-token call to keep the cache hot.

## 6. Sarvam STT (te/kn/ta only)

```
POST https://api.sarvam.ai/speech-to-text
Body: multipart/form-data { file: <audio Blob>, model: "saaras:v2", language_code: "te-IN" }
Headers: { "api-subscription-key": process.env.SARVAM_API_KEY }
```

5-second hard timeout in `/api/ai/transcribe`. NEVER persist audio bytes.

## 7. Telemetry (BullMQ, async)

```ts
// In /api/ai/parse-order/route.ts AFTER returning the response:
await voiceLogQueue.add("voice-parse-log", {
  vendorId, transcript, lang, sttSource, modelUsed,
  itemCount, confidence, unmatched, latencyMs, escalated,
});
```

The `voiceLog.worker.ts` upserts into `VoiceParseLog`. 90-day retention.
NEVER log customer phone, name, or audio bytes.

## 8. Vitest fixtures (ALL must pass before merge)

See `.cursor/rules/voice-ai.mdc` § Vitest fixtures table.
