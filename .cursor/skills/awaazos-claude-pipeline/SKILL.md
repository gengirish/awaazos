---
name: awaazos-claude-pipeline
description: Build the AwaazOS voice → Claude → cart pipeline. Use when implementing /api/ai/parse-order, /api/ai/transcribe, lib/anthropic.ts, lib/sarvam.ts, hooks/useVoiceOrder.ts, or workers/voiceLog.worker.ts. Covers two-tier Haiku/Sonnet routing, Anthropic tool-use, ephemeral prompt caching, Indic numeral normalization, and the Sarvam STT plumbing.
---

# AwaazOS Voice Pipeline

This is the project's core differentiator. Read these in order before writing
any voice/AI code.

## 1. Project rules (ALWAYS read first)

- `.cursor/rules/voice-ai.mdc` — STT routing, tool-use mandate, performance
  budget, PII guardrail, parse fixtures
- `.cursor/rules/security-first.mdc` — what NEVER goes to the LLM
- `.cursor/rules/india-locale.mdc` — paise integer discipline

## 2. Anthropic SDK patterns (read the relevant ones, not all)

No Anthropic SDK reference ships in this repo. Use your agent's Claude API
skill if it has one, otherwise the official Anthropic docs (TypeScript SDK).
Topics that matter here: tool use (CRITICAL — we use the `add_items` tool),
prompt caching (`cache_control: ephemeral`), and model IDs.

The installed SDK is `@anthropic-ai/sdk` `^0.132.1` — check that the method you
want exists in that version. NEVER guess SDK shape.

## 3. Two-tier model strategy

```
PRIMARY:  process.env.ANTHROPIC_PRIMARY_MODEL   (default 'claude-haiku-4-5')
FALLBACK: process.env.ANTHROPIC_FALLBACK_MODEL  (default 'claude-sonnet-4-5')
```

Centralize model IDs in `lib/anthropic.ts` constants, NOT scattered through
the codebase. Anthropic renames slugs — one place to update.

Escalate from Haiku → Sonnet ONLY if (`shouldEscalate()` + its `catch` in
`app/api/ai/parse-order/route.ts`):
- (a) the Haiku call throws for any reason — API error/timeout, no `add_items`
  tool_use block, or zod validation of the tool input fails
- (b) `items.length === 0` AND words > 3
- (c) `items.length === 0` AND words >= 2 AND `unmatched.length === 0`
- (d) `confidence === 'low'` AND `unmatched.length > 0`

`words` = `transcript.trim().split(/\s+/).filter(Boolean).length`.

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
NOT the user transcript. The menu block comes first so the cached prefix is
identical across calls; the transcript follows uncached (as in
`parseOrderWithClaude()`, `lib/anthropic.ts`):

```ts
{
  role: "user",
  content: [
    {
      type: "text",
      text: `Authoritative menu (JSON):\n${stableMenuJson(menu)}`,
      cache_control: { type: "ephemeral" },   // 5-min TTL
    },
    { type: "text", text: `Customer transcript (${lang}):\n${transcript}` },
  ],
}
```

`stableMenuJson()` sorts rows and keys deterministically — don't reorder it, or
every call misses the cache. There is no cache warmer (not implemented).

## 6. Server STT (`/api/ai/transcribe`)

STT is ASR only — never send audio to Anthropic. The route runs a per-language
cascade (`buildCascade()`), each hop behind its own circuit breaker and minute
quota, skipping providers that aren't configured:

- en/hi → OpenAI → Groq → Whisper (only reached when the browser isn't using
  Web Speech)
- te/kn/ta → Sarvam → Groq → Whisper — **dormant**: the language picker
  (`VOICE_LANGUAGES` in `lib/constants.ts`) offers only en-IN / hi-IN

Exhaustion returns 200 `{ error: "all_providers_failed", fallback: "quickadd" }`.
STT source ids live in `lib/stt-source.ts`.

Sarvam (`lib/sarvam.ts`):

```
POST https://api.sarvam.ai/speech-to-text
Body: multipart/form-data { file: <audio Blob>, model: "saaras:v3", language_code: "te-IN" }
Headers: { "api-subscription-key": process.env.SARVAM_API_KEY }
```

Model defaults to `saaras:v3` (override with `SARVAM_STT_MODEL`). 5-second hard
timeout via `AbortController` inside `lib/sarvam.ts`. NEVER persist audio bytes.

## 7. Telemetry (BullMQ, fire-and-forget)

```ts
// In /api/ai/parse-order/route.ts, before building the response — never awaited:
try {
  void getVoiceLogQueue().add(
    "voice-parse-log",
    { vendorId, transcript, lang, sttSource, modelUsed,
      latencyMs, itemCount, confidence, unmatched, escalated },
    { attempts: 1, removeOnComplete: true },
  );
} catch (queueErr) {
  // log the error message only, then carry on — the cashier never waits on logging
}
```

`workers/voiceLog.worker.ts` inserts (`create`) into `VoiceParseLog`.
90-day retention via `workers/retention.worker.ts`.
NEVER log customer phone, name, or audio bytes.

## 8. Parse fixtures (ALL must pass before merge)

See `.cursor/rules/voice-ai.mdc` § Parse fixtures. `npm test` runs the mocked
cases in `lib/__tests__/anthropic.test.ts`; model accuracy is checked by the
live golden suite (`GOLDEN_PARSE_ORDER_LIVE=1 npm run test:golden`, fixtures in
`tests/golden/parse-order/fixtures/`), which costs real money and is not in CI.
