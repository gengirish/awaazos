#!/usr/bin/env node
/**
 * NVIDIA Parakeet ASR smoke test (HTTP REST via NVCF).
 *
 *   node scripts/nvidia-smoke.mjs <path-to-audio> [lang]
 *
 *   lang defaults to "hi-IN"; valid: en-IN, hi-IN. en-IN is mapped to en-US
 *   for the Parakeet multilingual model (it does not publish en-IN).
 *
 * Exits 0 on a successful transcription, 1 on failure.
 *
 * NVIDIA_API_KEY is read from .env.local (or process.env). The API key is
 * never logged in full — only the first 6 chars + length.
 *
 * If the request fails with HTTP 404, the function-id may have changed; pass
 * a different one via NVIDIA_PARAKEET_FUNCTION_ID.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STT_TIMEOUT_MS = 15_000;

const DEFAULT_FUNCTION_ID = "71203149-d3b7-4460-8231-1be2543a1fca";
const DEFAULT_INFERENCE_PATH = "/v1/audio/transcriptions";

const LANG_MAP = {
  "en-IN": "en-US",
  "hi-IN": "hi-IN",
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

  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) {
    console.error("✗ NVIDIA_API_KEY missing from env / .env.local");
    process.exit(1);
  }
  if (!apiKey.startsWith("nvapi-")) {
    console.error("✗ NVIDIA_API_KEY does not start with 'nvapi-' — wrong format?");
    process.exit(1);
  }

  const audioPath = process.argv[2];
  const inputLang = process.argv[3] || "hi-IN";

  if (!audioPath) {
    console.error("✗ usage: node scripts/nvidia-smoke.mjs <path-to-audio> [lang]");
    console.error("  e.g.  node scripts/nvidia-smoke.mjs ./samples/hindi.wav hi-IN");
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

  const fnId = (process.env.NVIDIA_PARAKEET_FUNCTION_ID || DEFAULT_FUNCTION_ID).trim();
  const inferencePath = (
    process.env.NVIDIA_PARAKEET_INFERENCE_PATH || DEFAULT_INFERENCE_PATH
  ).trim();
  const url = `https://${fnId}.invocation.api.nvcf.nvidia.com${
    inferencePath.startsWith("/") ? inferencePath : `/${inferencePath}`
  }`;

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
            : ext === ".ogg" || ext === ".opus"
              ? "audio/ogg"
              : "application/octet-stream";

  const rivaLang = LANG_MAP[inputLang];

  console.log(JSON.stringify({
    event: "nvidia_smoke_start",
    apiKey: maskKey(apiKey),
    audio: { path: absAudio, sizeBytes: stat.size, mime },
    inputLang,
    rivaLang,
    functionId: fnId,
    url,
  }));

  const fd = new FormData();
  fd.append("file", new Blob([audioBytes], { type: mime }), path.basename(absAudio));
  fd.append("language", rivaLang);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), STT_TIMEOUT_MS);

  const t0 = Date.now();
  let res;
  try {
    res = await fetch(url, {
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
      event: "nvidia_smoke_network_error",
      error: err && err.message ? err.message : String(err),
    }));
    process.exit(1);
  }
  clearTimeout(timer);
  const durationMs = Date.now() - t0;

  const reqId = res.headers.get("nvcf-reqid");
  const text = await res.text();

  if (!res.ok) {
    console.error(JSON.stringify({
      event: "nvidia_smoke_http_error",
      status: res.status,
      durationMs,
      nvcfReqId: reqId,
      bodySnippet: text.slice(0, 400),
    }));
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    console.error(JSON.stringify({
      event: "nvidia_smoke_parse_error",
      durationMs,
      nvcfReqId: reqId,
      bodySnippet: text.slice(0, 400),
    }));
    process.exit(1);
  }

  const transcript =
    typeof parsed.text === "string" && parsed.text
      ? parsed.text
      : typeof parsed.transcript === "string" && parsed.transcript
        ? parsed.transcript
        : Array.isArray(parsed.segments)
          ? parsed.segments.map((s) => s?.text ?? "").join(" ").trim()
          : "";

  console.log(JSON.stringify({
    event: "nvidia_smoke_ok",
    durationMs,
    nvcfReqId: reqId,
    transcript,
    languageCode: parsed.language ?? null,
    confidence: parsed.confidence ?? null,
    rawKeys: Object.keys(parsed),
  }, null, 2));
}

main().catch((err) => {
  console.error("✗ unexpected", err);
  process.exit(1);
});
