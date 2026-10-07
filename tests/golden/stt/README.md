# Golden STT tests

Frozen `(audio clip, expected transcript)` pairs used to **gate new ASR backends**
before they enter the `/api/ai/transcribe` cascade.

STT golden tests are separate from `tests/golden/parse-order` (NLU/cart quality).
A backend must pass **both** harnesses before cutover:

```
audio → STT golden (transcript quality) → parse-order golden (cart quality)
```

## Layout

```
tests/golden/stt/
  fixtures/           # 12 fixtures aligned with parse-order ids (en 2, hi 4, te 2, kn 2, ta 2)
  audio/              # Synthetic .webm clips, gitignored (only .gitkeep and README.md are committed)
  fixtures.ts
  transcript-equality.ts
  driver.ts           # Providers: sarvam, openai, groq, whisper
  validate.test.ts    # Offline — runs in CI
  live.test.ts        # Real ASR — gated by GOLDEN_STT_LIVE=1
  .last-run/          # Diff artifacts (gitignored)
```

## Running

### Offline (CI default)

```bash
npm run test:golden:stt:validate
```

Validates fixture shape, language coverage, transcript normalization helpers.
Does **not** require audio files.

### Live (real ASR)

**No clips are committed.** Every fixture points at a `.webm` file under
`audio/` that isn't in the repo, so on a fresh checkout the live suite has no
runnable cases: each fixture is reported as `SKIP ... audio missing`. Record
the clips first.

1. Record synthetic clips (your own voice, no customer audio) into
   `tests/golden/stt/audio/<fixture-id>.webm` — one file per fixture.
2. Run:

```bash
GOLDEN_STT_LIVE=1 GOLDEN_STT_PROVIDERS=groq,whisper npm run test:golden:stt
```

`GOLDEN_STT_PROVIDERS` takes any of `sarvam`, `openai`, `groq`, `whisper`
(default `groq`). A provider whose keys or URL are missing, or that doesn't
support a fixture's language, is skipped rather than failed.

**Don't promote a new STT tier until its pass rate is within ~5% of the
current primary for that language** (Sarvam for te/kn/ta, OpenAI on the server
for en/hi; en/hi normally use the browser's Web Speech and never reach the
server). te/kn/ta are dormant in the voice-language picker, which offers only
en/hi.

Failed fixtures write diffs to `.last-run/<provider>/<fixture-id>.diff.json`.

## Wiring self-hosted Whisper

1. Deploy `services/whisper-stt` (see `services/whisper-stt/README.md`).
2. Set `WHISPER_STT_URL` + `WHISPER_STT_SECRET` on Vercel.
3. Calibrate: `GOLDEN_STT_LIVE=1 GOLDEN_STT_PROVIDERS=sarvam,whisper npm run test:golden:stt`
4. Only after pass rates match, Whisper stays in the cascade (already last-resort).

## Privacy

- Record clips in-house; never use customer audio.
- Audio under `tests/golden/stt/audio/` is gitignored by default.
