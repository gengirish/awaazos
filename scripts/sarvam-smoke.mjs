#!/usr/bin/env node
/**
 * Sarvam Saaras STT smoke test.
 *
 *   node scripts/sarvam-smoke.mjs <path-to-audio> [lang]
 *
 *   lang defaults to "hi-IN"; supported: hi-IN, te-IN, kn-IN, ta-IN, en-IN, etc.
 *
 * Exits 0 on a successful transcription, 1 on failure.
 *
 * SARVAM_API_KEY is read from .env.local (or process.env). The API key is
 * never logged in full -- only the first 6 chars + length.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SARVAM_STT_URL = "https://api.sarvam.ai/speech-to-text";
const STT_TIMEOUT_MS = 15_000;

function loadDotEnvLocal() {
  const envPath = path.resolve(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (!m) continue;
    const [, k, vRaw] = m;
    if (process.env[k]) continue; // do not clobber real env
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

  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) {
    console.error("✗ SARVAM_API_KEY missing from env / .env.local");
    process.exit(1);
  }

  const audioPath = process.argv[2];
  const lang = process.argv[3] || "hi-IN";

  if (!audioPath) {
    console.error("✗ usage: node scripts/sarvam-smoke.mjs <path-to-audio> [lang]");
    console.error("  e.g.  node scripts/sarvam-smoke.mjs ./samples/hindi.wav hi-IN");
    process.exit(1);
  }
  const absAudio = path.resolve(audioPath);
  if (!fs.existsSync(absAudio)) {
    console.error(`✗ audio file not found: ${absAudio}`);
    process.exit(1);
  }

  const stat = fs.statSync(absAudio);
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
            : "application/octet-stream";

  console.log(JSON.stringify({
    event: "sarvam_smoke_start",
    apiKey: maskKey(apiKey),
    audio: { path: absAudio, sizeBytes: stat.size, mime },
    lang,
    model: "saaras:v2",
    url: SARVAM_STT_URL,
  }));

  const fd = new FormData();
  fd.append("file", new Blob([audioBytes], { type: mime }), path.basename(absAudio));
  fd.append("model", "saaras:v2");
  fd.append("language_code", lang);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), STT_TIMEOUT_MS);

  const t0 = Date.now();
  let res;
  try {
    res = await fetch(SARVAM_STT_URL, {
      method: "POST",
      headers: { "api-subscription-key": apiKey },
      body: fd,
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    console.error(JSON.stringify({
      event: "sarvam_smoke_network_error",
      error: err && err.message ? err.message : String(err),
    }));
    process.exit(1);
  }
  clearTimeout(timer);
  const durationMs = Date.now() - t0;

  const text = await res.text();
  if (!res.ok) {
    console.error(JSON.stringify({
      event: "sarvam_smoke_http_error",
      status: res.status,
      durationMs,
      bodySnippet: text.slice(0, 400),
    }));
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    console.error(JSON.stringify({
      event: "sarvam_smoke_parse_error",
      durationMs,
      bodySnippet: text.slice(0, 400),
    }));
    process.exit(1);
  }

  console.log(JSON.stringify({
    event: "sarvam_smoke_ok",
    durationMs,
    transcript: parsed.transcript ?? "",
    languageCode: parsed.language_code ?? null,
    languageProbability: parsed.language_probability ?? null,
    requestId: parsed.request_id ?? null,
  }, null, 2));
}

main().catch((err) => {
  console.error("✗ unexpected", err);
  process.exit(1);
});
