#!/usr/bin/env node
/**
 * Voice-over for demo videos, through the local `vo` tool (docs/DEMO_VIDEOS_PLAN.md).
 * Kokoro text-to-speech on this machine: no caption text leaves it, and nothing is billed.
 *
 *   npm run demo:voice:prep      measure how long each recorded caption takes to say
 *   npm run demo:voice           narrate every rendered Reel from its captions
 *   npm run demo:voice -- --scene c1-buyer-order
 *
 * Order of a full take:
 *   demo:record → demo:voice:prep → (demo:record again if prep says so) → demo:render → demo:voice
 *
 * prep caches spoken lengths in demo-output/tts/<voice>.json; the Director reads them
 * while recording, so a caption never starts before the previous line has been said
 * (vo's anchored pacing would otherwise push every later line late). The second
 * record is only needed when captions changed or were never measured.
 *
 * Settings (env):
 *   VO_PROJECT   the vo checkout (default: ../video-pipeline beside the main awaazos checkout)
 *   DEMO_VOICE   Kokoro voice (default hf_beta: Indian, reading English)
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const RAW = path.join(ROOT, "demo-output", "raw");
const FINAL = path.join(ROOT, "demo-output", "final");
const TTS = path.join(ROOT, "demo-output", "tts");
const VO_RUNS = path.join(ROOT, "demo-output", "vo-runs");
/** hf_beta: an Indian voice reading English, picked by ear (2026-11-16). Same default as demo/kit/director.ts. */
const DEFAULT_VOICE = "hf_beta";
const VOICE = process.env.DEMO_VOICE || DEFAULT_VOICE;
/** vo's own floor between two lines (vo/config.py PAUSE_MIN). */
const VO_PAUSE_MIN = 0.12;

function findVoProject() {
  if (process.env.VO_PROJECT) return path.resolve(process.env.VO_PROJECT);
  // A worktree lives under <main>/.claude/worktrees/<name>; vo sits beside <main>.
  const main = ROOT.includes(`${path.sep}.claude${path.sep}worktrees${path.sep}`)
    ? ROOT.slice(0, ROOT.indexOf(`${path.sep}.claude${path.sep}worktrees${path.sep}`))
    : ROOT;
  return path.resolve(main, "..", "video-pipeline");
}
const VO = findVoProject();

function requireVo() {
  if (!fs.existsSync(path.join(VO, "vo", "cli.py"))) {
    console.error(`The vo project isn't at ${VO}. Set VO_PROJECT to its folder.`);
    process.exit(1);
  }
}

/** Run inside the vo project, so it reads its own settings, never this repo's. */
function uv(args, input) {
  return execFileSync("uv", ["run", "--project", VO, ...args], {
    cwd: VO,
    input,
    encoding: "utf8",
    // With input, stdout is the answer; without, vo's own progress goes straight to the terminal.
    stdio: input === undefined ? "inherit" : ["pipe", "pipe", "inherit"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

const args = process.argv.slice(2);
const command = args[0] && !args[0].startsWith("--") ? args[0] : "narrate";
const only = args.includes("--scene") ? args[args.indexOf("--scene") + 1] : null;

function recordedScenes() {
  if (!fs.existsSync(RAW)) return [];
  const out = [];
  for (const scene of fs.readdirSync(RAW)) {
    if (only && scene !== only) continue;
    for (const project of fs.readdirSync(path.join(RAW, scene))) {
      const cues = path.join(RAW, scene, project, "cues.json");
      if (fs.existsSync(cues)) out.push({ scene, project, cues: JSON.parse(fs.readFileSync(cues, "utf8")) });
    }
  }
  return out;
}

function prep() {
  requireVo();
  const cacheFile = path.join(TTS, `${VOICE}.json`);
  const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, "utf8")) : {};
  const scenes = recordedScenes();
  if (scenes.length === 0) {
    console.error("Nothing recorded yet: run `npm run demo:record` first.");
    process.exit(1);
  }

  const missing = [...new Set(scenes.flatMap((s) => s.cues.map((c) => c.text)).filter((t) => t && !(t in cache)))];
  if (missing.length > 0) {
    console.log(`Measuring ${missing.length} caption(s) with Kokoro (${VOICE})…`);
    const measured = JSON.parse(
      uv(["python", path.join(ROOT, "scripts", "demo-videos", "tts_durations.py")], JSON.stringify({ voice: VOICE, texts: missing })),
    );
    for (const m of measured) cache[m.text] = m.duration;
    fs.mkdirSync(TTS, { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
  }

  // Would any line run into the next one in the take already on disk?
  let rerecord = false;
  for (const s of scenes) {
    const spoken = s.cues.filter((c) => c.text);
    const overlaps = [];
    spoken.forEach((c, i) => {
      const next = spoken[i + 1];
      if (!next) return;
      const over = c.t + cache[c.text] + VO_PAUSE_MIN - next.t;
      if (over > 0.05) overlaps.push(`  "${c.text}" runs ${over.toFixed(2)} s into the next line`);
    });
    if (overlaps.length > 0) {
      rerecord = true;
      console.log(`${s.scene} [${s.project}]: the voice would run late here:\n${overlaps.join("\n")}`);
    } else {
      console.log(`${s.scene} [${s.project}]: every line fits before the next one.`);
    }
  }
  if (rerecord) {
    console.log("\nRecord again (`npm run demo:record`): the Director now knows each line's real length.");
  }
}

function narrate() {
  requireVo();
  if (!fs.existsSync(FINAL)) {
    console.error("Nothing rendered yet: run `npm run demo:render` first.");
    process.exit(1);
  }
  const reels = fs.readdirSync(FINAL).filter((f) => /\.reel\.[a-z]{2}\.mp4$/.test(f));
  for (const reel of reels) {
    const [scene, , lang] = reel.replace(/\.mp4$/, "").split(".");
    if (only && scene !== only) continue;
    const srt = path.join(FINAL, `${scene}.${lang}.srt`);
    if (!fs.existsSync(srt)) {
      console.warn(`${reel}: no ${path.basename(srt)}, skipped`);
      continue;
    }
    // One file per voice, so voices can be compared side by side.
    const out = path.join(FINAL, `${scene}.reel.${lang}.${VOICE}.mp4`);
    console.log(`${reel}: voicing with ${VOICE}…`);
    // Captions are already burned in, so no soft subtitles; anchored pacing keeps each
    // line at its caption's time; the video stream is copied, never re-encoded.
    uv([
      "vo", "import-srt", path.join(FINAL, reel), srt,
      "--voice", VOICE, "--pace", "anchored", "--no-subtitles",
      "--out-dir", VO_RUNS, "--out", out,
    ]);
    console.log(`  → ${path.relative(ROOT, out)}`);
  }
}

if (command === "prep") prep();
else if (command === "narrate") narrate();
else {
  console.error(`Unknown command "${command}". Use prep or narrate.`);
  process.exit(1);
}
