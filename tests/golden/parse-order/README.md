# Golden parse-order tests

A frozen set of `(transcript, language, expectedCart)` tuples used to:

1. **Catch regressions** in `lib/anthropic.ts` (prompt edits, model swaps,
   tool-schema changes) before they hit production.
2. **Calibrate new parse-order providers** (Groq Llama, Gemini, etc.) by
   running the same fixtures against them and asserting cart equality vs the
   current Claude Haiku output.

The harness calls `parseOrderWithClaude()` in `lib/anthropic.ts` directly, one
model per provider. It does **not** go through `/api/ai/parse-order`, so the
route's Haiku→Sonnet escalation (`shouldEscalate()`) and its menu re-alignment
(`lib/parse-order-align.ts`) are not exercised. To see both tiers, run
`claude-haiku` and `claude-sonnet` side by side.

The harness is **synthetic** — fixtures are hand-written transcripts modelling
real Indian merchant utterances. No customer audio, no PII.

## Layout

```
tests/golden/parse-order/
  menu.json              # Stable test menu (22 items, decoupled from prod seed)
  fixtures/              # 24 fixtures: en 6, hi 8, te 4, kn 3, ta 3
  fixtures.ts            # Loader + Zod validation
  cart-equality.ts       # Strict diff helper
  driver.ts              # Provider abstraction (claude-haiku/sonnet wired; groq-llama, gemini-flash stubbed)
  validate.test.ts       # Offline shape + menu-ref check (runs in CI)
  live.test.ts           # Real LLM run, gated by env flag
  .last-run/             # Per-run diff artifacts (gitignored)
```

te/kn/ta are dormant in the product: the voice-language picker
(`VOICE_LANGUAGES` in `lib/constants.ts`) offers only en-IN and hi-IN, and the
Sarvam path is reachable only through legacy `voiceLang` rows. Their fixtures
stay so the prompt keeps handling them.

## Running the tests

### Offline (CI default)

```bash
npm run test:golden:validate
```

Asserts every fixture is well-formed, every `menuItemId` exists in the menu,
every supported language has at least 3 fixtures. Catches typos and rot. No
LLM calls.

### Live (real Claude run)

**Linux / macOS:**

```bash
GOLDEN_PARSE_ORDER_LIVE=1 npm run test:golden
```

**Windows PowerShell:**

```powershell
$env:GOLDEN_PARSE_ORDER_LIVE="1"; npm run test:golden
```

Without the env var, `npm run test:golden` no-ops with a clear "set
GOLDEN_PARSE_ORDER_LIVE=1" message. `live.test.ts` also matches the vitest glob,
so plain `npm test` picks it up and skips it the same way.

Defaults to `claude-haiku`. Each fixture is dispatched to the provider; pass
or fail is decided by `compareCarts()` (strict equality + min-confidence
threshold).

Failed fixtures dump a JSON diff under `.last-run/<provider>/<fixture-id>.diff.json`
for post-mortem.

A summary JSON is written to `.last-run/summary.json` at the end of the run
with pass/fail counts and p50/p95 latency per provider.

### Comparing providers (calibration)

To compare a new provider against the current baseline:

```bash
GOLDEN_PARSE_ORDER_LIVE=1 \
GOLDEN_PARSE_ORDER_PROVIDERS=claude-haiku,groq-llama \
npm run test:golden
```

`groq-llama` and `gemini-flash` are stubs today: they are reported as SKIPPED,
not failed. Once one is wired in `driver.ts`, this runs both providers against
every fixture and emits two summary blocks. **Don't roll out a new provider
as a fallback until its pass rate matches Claude Haiku within ~5%.**

## Adding a fixture

1. Pick the next available number for the language (`hi-009-...`, etc.)
2. Create `fixtures/<id>.json`:

```json
{
  "id": "hi-009-modifier",
  "lang": "hi-IN",
  "transcript": "ek tikha samosa",
  "expected": {
    "items": [{ "menuItemId": "samosa", "qty": 1 }],
    "unmatched": [],
    "minConfidence": "medium"
  },
  "tags": ["hindi", "modifier-ignored"],
  "notes": "Spice modifier ('tikha'=spicy) should not be billed separately and not appear as unmatched."
}
```

3. Run `npm run test:golden:validate` to verify shape.
4. If you can, run the live test on the new fixture only and inspect the diff:
   ```bash
   GOLDEN_PARSE_ORDER_LIVE=1 npm run test:golden -- -t "hi-009-modifier"
   ```

### What makes a good fixture

- **Real-world phrasing**, not stylized. Indian vendors slur, abbreviate,
  switch languages mid-sentence. Bake that in.
- **Cover one new behavior**, not 5. One concept per fixture is easier to
  diagnose when it fails.
- **Include the negative cases.** Out-of-domain ("scooty chahiye"), unmatched
  items, polite-noise utterances all need fixtures because they're how the
  model will fail in production.
- **Set `minConfidence` honestly.** If a transcript is genuinely ambiguous,
  `medium` is fine. Don't paper over weak prompts with `low`.

### What NOT to add

- Fixtures using customer phone, name, or any PII (covered by `security-first.mdc`)
- Fixtures that depend on an item NOT in `menu.json`. Add the item to the
  menu first.

## Wiring a new provider

To add a provider — e.g. when ready to evaluate Groq Llama-3.3 as a
parse-order fallback:

1. Build the adapter, e.g. `lib/groq-parse.ts`, exposing a function with the
   same signature as `parseOrderWithClaude(...)`. The output must conform to
   the existing `ParseOrderResult` zod shape (cart-equality.ts assumes it).
2. Replace the stub in `driver.ts`:
   ```ts
   const groqLlamaDispatcher: Dispatcher = async (menu, transcript, lang) => {
     const result = await parseOrderWithGroq(menu, transcript, lang);
     return { result, modelName: "llama-3.3-70b-versatile" };
   };
   ```
3. Add the provider to `IMPLEMENTED_PROVIDERS`.
4. Run the calibration: `GOLDEN_PARSE_ORDER_LIVE=1 GOLDEN_PARSE_ORDER_PROVIDERS=claude-haiku,groq-llama npm run test:golden`
5. Inspect `.last-run/groq-llama/*.diff.json` for failures. If pass rate is
   acceptable, file the rollout PR.

## Cost guard

Live runs cost real money:
- 24 fixtures × ~600 tokens prompt + ~150 tokens output ≈ 18k tokens / run
- Claude Haiku 4.5: ~$0.005 / run
- Claude Sonnet 4.5: ~$0.10 / run

Don't loop the live run in CI without a budget. `npm test` loads the live
suite but skips it unless `GOLDEN_PARSE_ORDER_LIVE=1` is set, so CI never calls
the model.
