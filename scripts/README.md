# scripts/

Operational utilities. Not deployed; run locally only.

## `sarvam-roundtrip.mjs`

End-to-end smoke test for the Sarvam Saaras voice pipeline. Synthesises a
Hindi phrase via Sarvam TTS (`bulbul:v2`, speaker `anushka`), then sends
the resulting WAV back through Sarvam STT (`saaras:v3` or whatever
`SARVAM_STT_MODEL` env says), and verifies the round-trip transcript
materially overlaps the input via word-level Jaccard similarity.

```bash
# default: "दो समोसा और एक चाय दे दो" in hi-IN
npm run smoke:sarvam

# or custom phrase + lang
node scripts/sarvam-roundtrip.mjs "ek aloo samosa de do" hi-IN
node scripts/sarvam-roundtrip.mjs "ఒక చాయ్ ఇవ్వండి" te-IN
```

Reads `SARVAM_API_KEY` and (optional) `SARVAM_STT_MODEL` from
`.env.local`. The API key is never logged in full -- only first 6 chars +
length. Exit codes:

- `0` -- TTS + STT both succeeded and Jaccard >= 0.4
- `1` -- network / HTTP / parse / config error (see emitted JSON)
- `2` -- both APIs returned 200 but transcript barely overlaps the input
  (model degradation -- worth investigating before a vendor demo)

## `sarvam-smoke.mjs`

Single-shot STT only. Use this when you have a real WebM/WAV recording
from a phone and want to verify the recognition path without burning a
TTS call.

```bash
node scripts/sarvam-smoke.mjs ./vendor-recording.webm hi-IN
```

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
