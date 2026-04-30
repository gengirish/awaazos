#!/usr/bin/env node
/**
 * Sarvam round-trip smoke test: TTS -> WAV -> STT -> transcript.
 *
 * Proves the SARVAM_API_KEY works end-to-end against both /text-to-speech
 * and /speech-to-text without any manual audio capture. Exits 0 only if
 * the returned transcript materially overlaps the input phrase (Hindi
 * tokeniser + simple Jaccard on word set, threshold 0.4 -- generous to
 * absorb TTS pronunciation drift).
 *
 *   node scripts/sarvam-roundtrip.mjs           # default Hindi phrase
 *   node scripts/sarvam-roundtrip.mjs "do samosa aur ek chai" hi-IN
 *
 * SARVAM_API_KEY is loaded from .env.local (not logged in full).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TTS_URL = "https://api.sarvam.ai/text-to-speech";
const STT_URL = "https://api.sarvam.ai/speech-to-text";
const TIMEOUT_MS = 20_000;

function loadDotEnvLocal() {
  const envPath = path.resolve(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (!m) continue;
    const [, k, vRaw] = m;
    if (process.env[k]) continue;
    let v = vRaw.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[k] = v;
  }
}

function mask(k) {
  return k ? `${k.slice(0, 6)}…(${k.length} chars)` : "(empty)";
}

async function withTimeout(promiseFn, ms, label) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await promiseFn(ctrl.signal);
  } catch (err) {
    if (ctrl.signal.aborted) throw new Error(`${label} timed out after ${ms}ms`);
    throw err;
  } finally {
    clearTimeout(t);
  }
}

async function ttsSynth(apiKey, text, lang) {
  return withTimeout(async (signal) => {
    const res = await fetch(TTS_URL, {
      method: "POST",
      headers: {
        "api-subscription-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: [text],
        target_language_code: lang,
        speaker: "anushka",
        model: "bulbul:v2",
        speech_sample_rate: 22050,
        enable_preprocessing: true,
      }),
      signal,
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`TTS HTTP ${res.status}: ${body.slice(0, 300)}`);
    let json;
    try { json = JSON.parse(body); } catch { throw new Error(`TTS parse error: ${body.slice(0, 200)}`); }
    const b64 = Array.isArray(json.audios) && json.audios.length > 0 ? json.audios[0] : null;
    if (!b64 || typeof b64 !== "string") {
      throw new Error(`TTS missing audios[0]: ${body.slice(0, 200)}`);
    }
    return Buffer.from(b64, "base64");
  }, TIMEOUT_MS, "tts");
}

async function sttRecognise(apiKey, audioBuf, lang) {
  return withTimeout(async (signal) => {
    const fd = new FormData();
    fd.append("file", new Blob([audioBuf], { type: "audio/wav" }), "rt.wav");
    fd.append("model", process.env.SARVAM_STT_MODEL || "saaras:v3");
    fd.append("language_code", lang);
    const res = await fetch(STT_URL, {
      method: "POST",
      headers: { "api-subscription-key": apiKey },
      body: fd,
      signal,
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`STT HTTP ${res.status}: ${body.slice(0, 300)}`);
    try { return JSON.parse(body); } catch { throw new Error(`STT parse error: ${body.slice(0, 200)}`); }
  }, TIMEOUT_MS, "stt");
}

function tokenise(s) {
  return new Set(
    String(s || "")
      .toLowerCase()
      .normalize("NFKC")
      .split(/[\s।,.!?]+/u)
      .map((w) => w.trim())
      .filter(Boolean)
  );
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter += 1;
  return inter / (a.size + b.size - inter);
}

async function main() {
  loadDotEnvLocal();
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) {
    console.error("✗ SARVAM_API_KEY missing from .env.local / env");
    process.exit(1);
  }

  const text = process.argv[2] || "दो समोसा और एक चाय दे दो";
  const lang = process.argv[3] || "hi-IN";

  console.log(JSON.stringify({
    event: "sarvam_roundtrip_start",
    apiKey: mask(apiKey),
    text,
    lang,
  }));

  const t0 = Date.now();
  let audio;
  try {
    audio = await ttsSynth(apiKey, text, lang);
  } catch (err) {
    console.error(JSON.stringify({
      event: "tts_failed",
      error: err && err.message ? err.message : String(err),
    }));
    process.exit(1);
  }
  const ttsMs = Date.now() - t0;
  console.log(JSON.stringify({ event: "tts_ok", durationMs: ttsMs, audioBytes: audio.length }));

  const tmpPath = path.resolve(__dirname, "..", `.sarvam-rt-${Date.now()}.wav`);
  fs.writeFileSync(tmpPath, audio);

  let parsed;
  const t1 = Date.now();
  try {
    parsed = await sttRecognise(apiKey, audio, lang);
  } catch (err) {
    console.error(JSON.stringify({
      event: "stt_failed",
      error: err && err.message ? err.message : String(err),
      tmpAudio: tmpPath,
    }));
    process.exit(1);
  }
  const sttMs = Date.now() - t1;
  fs.unlinkSync(tmpPath);

  const transcript = String(parsed.transcript || "").trim();
  const overlap = jaccard(tokenise(text), tokenise(transcript));

  console.log(JSON.stringify({
    event: "stt_ok",
    durationMs: sttMs,
    transcript,
    languageCode: parsed.language_code ?? null,
    languageProbability: parsed.language_probability ?? null,
    requestId: parsed.request_id ?? null,
    wordOverlapJaccard: Number(overlap.toFixed(3)),
  }, null, 2));

  if (!transcript) {
    console.error("✗ STT returned an empty transcript -- key works but recognition failed.");
    process.exit(1);
  }
  if (overlap < 0.4) {
    console.error(`⚠ STT transcript only ${overlap.toFixed(2)} jaccard overlap with TTS input.`);
    console.error("  This usually means the API works but the model/voice combination is poor.");
    process.exit(2);
  }

  console.log(`\n✓ Sarvam round-trip OK -- TTS ${ttsMs}ms + STT ${sttMs}ms, overlap ${overlap.toFixed(2)}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("✗ unexpected", err && err.message ? err.message : err);
  process.exit(1);
});
