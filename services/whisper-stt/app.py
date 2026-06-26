"""
AwaazOS self-hosted Whisper STT — faster-whisper HTTP service.

POST /v1/transcribe
  Authorization: Bearer <WHISPER_STT_SECRET>
  multipart: file (audio), language (ISO-639-1: en|hi|te|kn|ta)

GET /health — liveness (no auth)

Env:
  WHISPER_STT_SECRET   — shared bearer token (min 16 chars)
  WHISPER_MODEL        — faster-whisper model id (default: small)
  WHISPER_DEVICE       — cpu | cuda (default: cpu)
  WHISPER_COMPUTE_TYPE — int8 | float16 (default: int8 on cpu)
"""

from __future__ import annotations

import os
import tempfile
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

_model = None
_bearer = HTTPBearer(auto_error=False)

SUPPORTED_LANGS = frozenset({"en", "hi", "te", "kn", "ta"})


def _secret() -> str:
    s = os.getenv("WHISPER_STT_SECRET", "").strip()
    if len(s) < 16:
        raise RuntimeError("WHISPER_STT_SECRET must be at least 16 characters")
    return s


def _load_model():
    global _model
    if _model is not None:
        return _model
    from faster_whisper import WhisperModel

    model_size = os.getenv("WHISPER_MODEL", "small").strip()
    device = os.getenv("WHISPER_DEVICE", "cpu").strip()
    compute_type = os.getenv("WHISPER_COMPUTE_TYPE", "int8" if device == "cpu" else "float16").strip()
    _model = WhisperModel(model_size, device=device, compute_type=compute_type)
    return _model


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    _load_model()
    yield


app = FastAPI(title="AwaazOS Whisper STT", lifespan=lifespan)


def require_auth(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> None:
    if creds is None or creds.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="missing bearer token")
    if creds.credentials != _secret():
        raise HTTPException(status_code=401, detail="invalid token")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/v1/transcribe")
async def transcribe(
    _: None = Depends(require_auth),
    file: UploadFile = File(...),
    language: str = Form(...),
) -> dict[str, str | float]:
    lang = language.strip().lower()
    if lang not in SUPPORTED_LANGS:
        raise HTTPException(status_code=400, detail=f"unsupported language: {language}")

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="empty audio")

    model = _load_model()
    suffix = ".webm"
    if file.filename and "." in file.filename:
        suffix = "." + file.filename.rsplit(".", 1)[-1].lower()

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=True) as tmp:
        tmp.write(raw)
        tmp.flush()
        segments, _info = model.transcribe(
            tmp.name,
            language=lang,
            beam_size=5,
            vad_filter=True,
            temperature=0.0,
        )
        text = " ".join(s.text.strip() for s in segments).strip()

    return {"text": text, "confidence": 0.85}
