#!/usr/bin/env node
/**
 * Self-hosted Whisper STT smoke test.
 *
 *   node scripts/whisper-stt-smoke.mjs <path-to-audio> [lang]
 *
 *   lang defaults to "hi-IN"; valid: en-IN, hi-IN, te-IN, kn-IN, ta-IN.
 *
 * Reads WHISPER_STT_URL and WHISPER_STT_SECRET from .env.local or process.env.
 * Exits 0 on success, 1 on failure.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STT_TIMEOUT_MS = 15_000;

const LANG_MAP = {
  "en-IN": "en",
  "hi-IN": "hi",
  "te-IN": "te",
  "kn-IN": "kn",
  "ta-IN": "ta",
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

async function main() {
  loadDotEnvLocal();

  const baseUrl = process.env.WHISPER_STT_URL?.replace(/\/$/, "");
  const secret = process.env.WHISPER_STT_SECRET;

  if (!baseUrl?.startsWith("http")) {
    console.error("✗ WHISPER_STT_URL missing or invalid");
    process.exit(1);
  }
  if (!secret || secret.length < 16) {
    console.error("✗ WHISPER_STT_SECRET must be at least 16 characters");
    process.exit(1);
  }

  const audioPath = process.argv[2];
  const inputLang = process.argv[3] || "hi-IN";

  if (!audioPath) {
    console.error("✗ usage: node scripts/whisper-stt-smoke.mjs <path-to-audio> [lang]");
    process.exit(1);
  }

  const language = LANG_MAP[inputLang];
  if (!language) {
    console.error(`✗ unsupported lang: ${inputLang}`);
    process.exit(1);
  }

  const absAudio = path.resolve(audioPath);
  if (!fs.existsSync(absAudio)) {
    console.error(`✗ audio file not found: ${absAudio}`);
    process.exit(1);
  }

  const buf = fs.readFileSync(absAudio);
  const ext = path.extname(absAudio).toLowerCase() || ".webm";
  const body = new FormData();
  body.append("file", new Blob([buf]), `clip${ext}`);
  body.append("language", language);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STT_TIMEOUT_MS);

  try {
    const res = await fetch(`${baseUrl}/v1/transcribe`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        Accept: "application/json",
      },
      body,
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`✗ Whisper STT HTTP ${res.status}: ${errText.slice(0, 300)}`);
      process.exit(1);
    }

    const data = await res.json();
    const transcript = typeof data.text === "string" ? data.text : "";
    console.log(JSON.stringify({ transcript, lang: inputLang, confidence: data.confidence }, null, 2));

    if (!transcript.trim()) {
      console.error("✗ empty transcript");
      process.exit(1);
    }

    console.log("✓ whisper STT smoke passed");
  } catch (err) {
    console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  } finally {
    clearTimeout(timeout);
  }
}

main();
