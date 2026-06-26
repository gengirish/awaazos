# Self-hosted Whisper STT (spike)

Optional last-resort ASR tier for AwaazOS. **Does not replace Sarvam/OpenAI until
`tests/golden/stt` pass rates match** the current primary for each language.

## Local dev

```bash
cd services/whisper-stt
python -m venv .venv
# Windows: .venv\Scripts\activate
source .venv/bin/activate
pip install -r requirements.txt
export WHISPER_STT_SECRET="dev-secret-min-16-chars"
uvicorn app:app --reload --port 8080
```

Point the Next.js app at it:

```env
WHISPER_STT_URL=http://localhost:8080
WHISPER_STT_SECRET=dev-secret-min-16-chars
```

Smoke test:

```bash
node scripts/whisper-stt-smoke.mjs path/to/clip.webm hi-IN
```

## Fly deploy

```bash
cd services/whisper-stt
fly apps create awaazos-whisper-stt   # once
fly secrets set WHISPER_STT_SECRET="$(openssl rand -hex 24)"
fly deploy
```

Set the same secret on Vercel as `WHISPER_STT_SECRET` and the public URL as
`WHISPER_STT_URL=https://awaazos-whisper-stt.fly.dev`.

For production Indic quality, move to a GPU machine (`WHISPER_DEVICE=cuda`,
`WHISPER_MODEL=large-v3`, `WHISPER_COMPUTE_TYPE=float16`) and update `fly.toml`
`[[vm]]` size accordingly.

## Privacy

Audio is processed on infrastructure we control. No third-party ASR when this
tier answers. Still treat clips as sensitive — do not log audio bytes.
