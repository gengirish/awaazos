# scripts/

Operational utilities. Not deployed; run locally only.

| Script | npm script | What it checks |
|---|---|---|
| `sarvam-roundtrip.mjs` | `npm run smoke:sarvam` | Sarvam TTS → STT round trip (no audio file needed) |
| `openai-stt-smoke.mjs` | `npm run smoke:openai` | OpenAI transcription of a local clip |
| `groq-stt-smoke.mjs` | `npm run smoke:groq` | Groq Whisper transcription of a local clip |
| `whisper-stt-smoke.mjs` | `npm run smoke:whisper` | Self-hosted Whisper (`services/whisper-stt`) on a local clip |
| `generate-pwa-icons.mjs` | none | Regenerates the PWA / push icons in `public/` |
| `sync-agent-rules.mjs` | `npm run sync:agent-rules` | Regenerates `.claude/rules` + `.claude/skills` from `.cursor/` |
| `razorpay-create-plans.ts` | `npm run razorpay:create-plans` | Dry-runs (or with `-- --create`, creates) the Starter monthly/yearly subscription plans in Razorpay; prints the env ids |

The smoke scripts are one-shot round trips against a live provider, for checking credentials and
connectivity. They read keys from `.env.local` (an already-set environment variable wins) and never
print a key in full. Use your own or synthetic clips only, never vendor or customer audio. Pass
arguments to an npm script after `--`, e.g. `npm run smoke:openai -- clip.webm en-IN`.

## `sarvam-roundtrip.mjs`

Synthesises a phrase with Sarvam TTS (`bulbul:v2`, speaker `anushka`), sends the WAV back through
Sarvam STT (`SARVAM_STT_MODEL`, default `saaras:v3`), and checks that the transcript overlaps the
input by word-level Jaccard similarity.

```bash
# default: "दो समोसा और एक चाय दे दो" in hi-IN
npm run smoke:sarvam

# or custom phrase + lang
node scripts/sarvam-roundtrip.mjs "ek aloo samosa de do" hi-IN
node scripts/sarvam-roundtrip.mjs "ఒక చాయ్ ఇవ్వండి" te-IN
```

Env: `SARVAM_API_KEY`, optional `SARVAM_STT_MODEL`. Exit codes:

- `0`: TTS and STT both succeeded and Jaccard >= 0.4
- `1`: network / HTTP / parse / config error (see the emitted JSON)
- `2`: both APIs returned 200 but the transcript barely overlaps the input (model degradation;
  worth investigating before a vendor demo)

## `openai-stt-smoke.mjs`

```bash
node scripts/openai-stt-smoke.mjs <path-to-audio> [lang]
```

`lang` is `en-IN` or `hi-IN` (default `hi-IN`). Model is `OPENAI_STT_MODEL`, default
`gpt-4o-mini-transcribe`. Env: `OPENAI_API_KEY`. Files over 25 MB are rejected. Exit `0` on a
transcript, `1` on any failure. Don't send real customer audio to an org without zero data
retention.

## `groq-stt-smoke.mjs`

```bash
node scripts/groq-stt-smoke.mjs <path-to-audio> [lang]
```

`lang` is one of `en-IN`, `hi-IN`, `te-IN`, `kn-IN`, `ta-IN` (default `hi-IN`). Model is
`GROQ_STT_MODEL`, default `whisper-large-v3-turbo`. Env: `GROQ_API_KEY`. Exit `0` on a transcript,
`1` on any failure. Don't run it on vendor audio until a DPDP-compliant agreement with Groq is in
place.

## `whisper-stt-smoke.mjs`

```bash
node scripts/whisper-stt-smoke.mjs <path-to-audio> [lang]
```

Posts the clip to `${WHISPER_STT_URL}/v1/transcribe` with `Authorization: Bearer
${WHISPER_STT_SECRET}`. `lang` is one of `en-IN`, `hi-IN`, `te-IN`, `kn-IN`, `ta-IN` (default
`hi-IN`). `WHISPER_STT_SECRET` must be at least 16 characters. Exit `0` on a transcript, `1` on any
failure. The Fly app scales to zero, so the first call after idle is slow.

## `generate-pwa-icons.mjs`

```bash
node scripts/generate-pwa-icons.mjs
```

Renders `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` and `badge-72.png` into `public/`
from an inline SVG, using the Playwright Chromium already installed for e2e.

## `sync-agent-rules.mjs`

```bash
npm run sync:agent-rules                     # write .claude/
node scripts/sync-agent-rules.mjs --check    # exit 1 if .claude/ is out of date
```

`.cursor/rules/*.mdc` and `.cursor/skills/` are the source of truth for agent conventions. This
converts each rule to Claude Code's format (`.md`, `globs` → `paths`, `alwaysApply: true` → no
`paths`), copies skills verbatim, and deletes anything in `.claude/rules` or `.claude/skills` that
has no source. A rule with neither `alwaysApply` nor `globs` is an error, since Claude Code has no
manual-only equivalent.
