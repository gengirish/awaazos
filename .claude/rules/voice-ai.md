---
description: Voice STT + Claude NLU pipeline rules (the AwaazOS differentiator)
paths: ["lib/anthropic.ts","lib/sarvam.ts","hooks/useVoice*.ts","app/api/ai/**/*.ts","components/pos/VoiceOrderButton.tsx","workers/voiceLog.worker.ts"]
---

<!-- Generated from .cursor/rules/voice-ai.mdc by scripts/sync-agent-rules.mjs. Edit the source, then re-run. -->

# Voice Pipeline Rules — AwaazOS

## STT routing (by `VendorSettings.voiceLang`)

| Lang | STT |
|---|---|
| `en-IN`, `hi-IN` | Web Speech API (browser, free, all plans) |
| `te-IN`, `kn-IN`, `ta-IN` | Sarvam Saaras v2 via `/api/ai/transcribe` (STARTER+ only) |

**STT vs NLU:** STT turns audio → text (ASR only — no Claude). NLU
(`/api/ai/parse-order`) turns text + menu → cart (Claude Haiku/Sonnet).
Self-hosted Whisper (`lib/whisper-stt.ts`) is an optional last-resort STT tier
when `WHISPER_STT_URL` is set — never used for menu matching.

Server STT cascade (when Web Speech skipped): te/kn/ta → Sarvam → Groq →
Whisper; en/hi → OpenAI → Groq → NVIDIA → Whisper.

FREE-tier vendors with te/kn/ta selected → fall back to QuickAddGrid + show
upgrade nudge. Never auto-charge by routing them to Sarvam.

## Claude two-tier NLU

```
Haiku 4.5 (primary, fast, cheap, schema-strict tool-use)
   ↓ escalate ONLY if:
   (a) zod validation fails / JSON.parse throws
   (b) items === [] AND transcript.split(/\s+/).length > 3
   (c) confidence === 'low' AND unmatched.length > 0
Sonnet 4.5 (fallback)
```

## Tool-use, not free-form JSON

Define ONE tool `add_items` with `input_schema` matching the contract:

```ts
{
  items: { menuItemId, name, priceInPaise, qty }[],
  unmatched: string[],
  confidence: "high" | "medium" | "low"
}
```

Tool use guarantees well-formed output and lets the cart UI stream item-by-item.

## Prompt caching

- Wrap the menu block (the expensive, repeated input) with
  `cache_control: { type: 'ephemeral' }`.
- 5-min TTL → optimistically warm the cache every 4 minutes while POS is open
  AND `vendor.plan ≥ STARTER`.

## Performance budget

- Web Speech latency: ≤ 200 ms perceived
- Sarvam STT round-trip: 5 s hard timeout (then fallback)
- Haiku tool-use: target ≤ 1 s p50
- Total mic-press → first cart item visible: target ≤ 2 s p50

## Logging — privacy-critical

- ENQUEUE (do NOT await) BullMQ `voice-parse-log` job from `/api/ai/parse-order`
- Log to `VoiceParseLog`: `{vendorId, transcript, lang, sttSource, modelUsed,
  itemCount, confidence, unmatched, latencyMs, escalated}`
- 90-day TTL via scheduled cleanup
- **NEVER log:** `customerPhone`, `customerName`, payment data, audio bytes,
  vendor menu prices, UTR refs

## PII guardrail

Customer phone/name MUST NOT appear in any prompt, log, or telemetry sent to
Anthropic or Sarvam. Only `transcript` + `menu` go to the LLM.

## Indic numeral normalization (in system prompt)

Hard-code in the prompt — don't rely on the model to know:
```
hi: ek=1, do=2, teen=3, char=4, paanch=5
te: okati=1, rendu=2, moodu=3, naalugu=4, aidu=5
kn: ondu=1, eradu=2, mooru=3, naalku=4, aidu=5
ta: onnu=1, rendu=2, moonu=3, naangu=4, anju=5
```

## Vitest fixtures (must all pass)

| Transcript | Lang | Expected |
|---|---|---|
| `"do bhel aur ek nimbu pani"` | hi-IN | bhel×2, nimbu pani×1 |
| `"one small bhel and two lemonades"` | en-IN | small bhel×1, lemonade×2 |
| `"rendu large bhel"` | te-IN | large bhel×2 |
| `"moodu samosa, okati chai"` | te-IN | samosa×3, chai×1 |
| `"ek vada pav"` | hi-IN | vada pav×1 |
| `"scooty chahiye"` | hi-IN | items:[], unmatched:["scooty chahiye"], confidence:'low' |
