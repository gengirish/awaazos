#!/usr/bin/env node
/**
 * OpenAI gpt-4o-mini-transcribe smoke test.
 *
 *   node scripts/openai-stt-smoke.mjs <path-to-audio> [lang]
 *
 *   lang defaults to "hi-IN"; valid: en-IN, hi-IN. Both get mapped to the
 *   ISO-639-1 base code (en, hi) before being sent to OpenAI.
 *
 * Exits 0 on a successful transcription, 1 on failure.
 *
 * OPENAI_API_KEY is read from .env.local (or process.env). The API key is
 * never logged in full — only the first 6 chars + length.
 *
 * IMPORTANT: do NOT run against a non-ZDR org with real customer audio.
 * Use only synthetic / your-own clips before ZDR is provisioned.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OPENAI_STT_URL = "https://api.openai.com/v1/audio/transcriptions";
const STT_TIMEOUT_MS = 15_000;

const DEFAULT_MODEL = "gpt-4o-mini-transcribe";

const LANG_MAP = {
  "en-IN": "en",
  "hi-IN": "hi",
};

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

function maskKey(k) {
  if (!k) return "(empty)";
  return `${k.slice(0, 6)}…(${k.length} chars)`;
}

async function main() {
  loadDotEnvLocal();

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("✗ OPENAI_API_KEY missing from env / .env.local");
    process.exit(1);
  }
  if (!apiKey.startsWith("sk-")) {
    console.error("✗ OPENAI_API_KEY does not start with 'sk-' — wrong format?");
    process.exit(1);
  }

  const audioPath = process.argv[2];
  const inputLang = process.argv[3] || "hi-IN";

  if (!audioPath) {
    console.error("✗ usage: node scripts/openai-stt-smoke.mjs <path-to-audio> [lang]");
    console.error("  e.g.  node scripts/openai-stt-smoke.mjs ./samples/hindi.wav hi-IN");
    process.exit(1);
  }
  const absAudio = path.resolve(audioPath);
  if (!fs.existsSync(absAudio)) {
    console.error(`✗ audio file not found: ${absAudio}`);
    process.exit(1);
  }
  if (!(inputLang in LANG_MAP)) {
    console.error(`✗ unsupported lang: ${inputLang} (valid: ${Object.keys(LANG_MAP).join(", ")})`);
    process.exit(1);
  }

  const stat = fs.statSync(absAudio);
  if (stat.size > 25 * 1024 * 1024) {
    console.error(`✗ audio file exceeds 25 MB OpenAI limit (got ${stat.size} bytes)`);
    process.exit(1);
  }

  const audioBytes = fs.readFileSync(absAudio);
  const ext = path.extname(absAudio).toLowerCase();
  const mime =
    ext === ".wav"
      ? "audio/wav"
      : ext === ".mp3"
        ? "audio/mpeg"
        : ext === ".webm"
          ? "audio/webm"
          : ext === ".m4a"
            ? "audio/mp4"
            : ext === ".ogg" || ext === ".opus"
              ? "audio/ogg"
              : "application/octet-stream";

  const model = (process.env.OPENAI_STT_MODEL || DEFAULT_MODEL).trim();
  const language = LANG_MAP[inputLang];

  console.log(JSON.stringify({
    event: "openai_stt_smoke_start",
    apiKey: maskKey(apiKey),
    audio: { path: absAudio, sizeBytes: stat.size, mime },
    inputLang,
    language,
    model,
    url: OPENAI_STT_URL,
  }));

  const fd = new FormData();
  fd.append("file", new Blob([audioBytes], { type: mime }), path.basename(absAudio));
  fd.append("model", model);
  fd.append("language", language);
  fd.append("response_format", "json");
  fd.append("include[]", "logprobs");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), STT_TIMEOUT_MS);

  const t0 = Date.now();
  let res;
  try {
    res = await fetch(OPENAI_STT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      body: fd,
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    console.error(JSON.stringify({
      event: "openai_stt_smoke_network_error",
      error: err && err.message ? err.message : String(err),
    }));
    process.exit(1);
  }
  clearTimeout(timer);
  const durationMs = Date.now() - t0;

  const reqId = res.headers.get("x-request-id");
  const text = await res.text();

  if (!res.ok) {
    console.error(JSON.stringify({
      event: "openai_stt_smoke_http_error",
      status: res.status,
      durationMs,
      requestId: reqId,
      bodySnippet: text.slice(0, 400),
    }));
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    console.error(JSON.stringify({
      event: "openai_stt_smoke_parse_error",
      durationMs,
      requestId: reqId,
      bodySnippet: text.slice(0, 400),
    }));
    process.exit(1);
  }

  // Compute confidence the same way the production adapter does.
  let confidence = 0.85;
  if (Array.isArray(parsed.logprobs) && parsed.logprobs.length > 0) {
    let sum = 0;
    let n = 0;
    for (const t of parsed.logprobs) {
      if (typeof t.logprob === "number" && Number.isFinite(t.logprob)) {
        sum += Math.exp(t.logprob);
        n += 1;
      }
    }
    if (n > 0) {
      const mean = sum / n;
      if (Number.isFinite(mean)) {
        confidence = Math.max(0, Math.min(1, mean));
      }
    }
  }

  console.log(JSON.stringify({
    event: "openai_stt_smoke_ok",
    durationMs,
    requestId: reqId,
    transcript: parsed.text ?? "",
    confidence,
    usage: parsed.usage ?? null,
    rawKeys: Object.keys(parsed),
  }, null, 2));
}

main().catch((err) => {
  console.error("✗ unexpected", err);
  process.exit(1);
});
