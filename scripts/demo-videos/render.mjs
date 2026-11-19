#!/usr/bin/env node
/**
 * Turn recorded demo scenes into videos (docs/DEMO_VIDEOS_PLAN.md, "Render pipeline").
 *
 *   npm run demo:render                    # every scene in demo-output/raw
 *   npm run demo:render -- --scene c1-buyer-order
 *
 * For each demo-output/raw/<scene>/<project>/ it writes to demo-output/final/:
 *   <scene>.screen.mp4    the phone screen alone, 1080 × 1920, no captions (for editing)
 *   <scene>.reel.en.mp4   9:16 Reel: store-colour background, captions above the phone
 *   <scene>.en.srt        the captions as subtitles (YouTube, or a later voice-over)
 *   <scene>.poster.jpg    one frame for <video poster> and link previews
 *
 * Captions and the phone frame are drawn by headless Chrome as PNGs (so they use the
 * brand fonts), then composed with ffmpeg. Needs ffmpeg on PATH, or FFMPEG=<path>.
 * Both MP4s carry a silent audio track; `npm run demo:voice` replaces it with the voice-over.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { chromium } from "@playwright/test";

const ROOT = process.cwd();
const RAW = path.join(ROOT, "demo-output", "raw");
const FINAL = path.join(ROOT, "demo-output", "final");
const FFMPEG = process.env.FFMPEG || "ffmpeg";

const W = 1080;
const H = 1920;
/** The phone screen inside the Reel: 9:16 at 846 × 1504, under a caption band. */
const SCREEN = { x: 117, y: 380, w: 846, h: 1504, radius: 44, bezel: 16 };
const CAPTION = { y: 24, h: 330 };
const FADE = 0.2;

const args = process.argv.slice(2);
const only = args.includes("--scene") ? args[args.indexOf("--scene") + 1] : null;

function ffmpeg(argv) {
  execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...argv], { stdio: "inherit" });
}

function srtTime(s) {
  const ms = Math.max(0, Math.round(s * 1000));
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3_600_000))}:${p(Math.floor(ms / 60_000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
}

const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const FONTS =
  '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
  '<link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@700&display=block" rel="stylesheet">';

/** Draw the background, the screen mask and one PNG per caption. */
async function drawCards(dir, accent, captions) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: W, height: H } });

    const shot = async (html, file, size, transparent = false) => {
      await page.setViewportSize(size);
      await page.setContent(`<!doctype html><html><head>${FONTS}<style>html,body{margin:0}</style></head><body>${html}</body></html>`, {
        waitUntil: "networkidle",
      });
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: path.join(dir, file), omitBackground: transparent });
    };

    const b = SCREEN.bezel;
    await shot(
      `<div style="position:relative;width:${W}px;height:${H}px;overflow:hidden;
         background:radial-gradient(120% 70% at 50% 0%, color-mix(in srgb, ${accent} 70%, white) 0%, ${accent} 55%, color-mix(in srgb, ${accent} 70%, black) 100%)">
         <div style="position:absolute;left:${SCREEN.x - b}px;top:${SCREEN.y - b}px;width:${SCREEN.w + 2 * b}px;height:${SCREEN.h + 2 * b}px;
           border-radius:${SCREEN.radius + b}px;background:#111827;box-shadow:0 30px 80px rgba(0,0,0,.35)"></div>
       </div>`,
      "bg.png",
      { width: W, height: H },
    );

    await shot(
      `<div style="width:${SCREEN.w}px;height:${SCREEN.h}px;background:#000">
         <div style="width:100%;height:100%;border-radius:${SCREEN.radius}px;background:#fff"></div></div>`,
      "mask.png",
      { width: SCREEN.w, height: SCREEN.h },
    );

    for (const [i, c] of captions.entries()) {
      await shot(
        `<div style="width:${W}px;height:${CAPTION.h}px;display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:0 70px">
           <p style="margin:0;font:700 68px/1.15 'Baloo 2',system-ui,sans-serif;color:#fff;text-align:center;
             text-shadow:0 3px 14px rgba(0,0,0,.35);text-wrap:balance">${escapeHtml(c.text)}</p></div>`,
        `cap-${i}.png`,
        { width: W, height: CAPTION.h },
        true,
      );
    }
  } finally {
    await browser.close();
  }
}

async function renderOne(sceneDir, scene) {
  const log = JSON.parse(fs.readFileSync(path.join(sceneDir, "frames.json"), "utf8"));
  const cues = JSON.parse(fs.readFileSync(path.join(sceneDir, "cues.json"), "utf8"));
  const meta = JSON.parse(fs.readFileSync(path.join(sceneDir, "meta.json"), "utf8"));
  if (log.frames.length === 0) throw new Error(`${scene}: no frames recorded`);

  const work = path.join(sceneDir, "render");
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  fs.mkdirSync(FINAL, { recursive: true });

  // 1. Frames → constant 30 fps, each frame held until the next one was painted.
  const t0 = log.frames[0].t;
  const duration = log.stoppedAt - t0;
  const lines = ["ffconcat version 1.0"];
  log.frames.forEach((f, i) => {
    const next = i + 1 < log.frames.length ? log.frames[i + 1].t : log.stoppedAt;
    lines.push(`file '${path.join(sceneDir, "frames", f.file).replace(/\\/g, "/")}'`, `duration ${Math.max(0.001, next - f.t).toFixed(4)}`);
  });
  // The concat demuxer drops the last duration unless the file is listed again.
  lines.push(`file '${path.join(sceneDir, "frames", log.frames.at(-1).file).replace(/\\/g, "/")}'`);
  const list = path.join(work, "frames.ffconcat");
  fs.writeFileSync(list, lines.join("\n"));

  // A silent stereo track: the voice-over tool (vo) refuses a video with no audio
  // stream, and Instagram handles a video with an audio track more reliably.
  const screenMp4 = path.join(FINAL, `${scene}.screen.mp4`);
  ffmpeg([
    "-f", "concat", "-safe", "0", "-i", list,
    "-f", "lavfi", "-t", duration.toFixed(3), "-i", "anullsrc=r=48000:cl=stereo",
    "-vf", `fps=30,scale=${W}:${H}:flags=lanczos,format=yuv420p`,
    "-map", "0:v", "-map", "1:a",
    "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-c:a", "aac", "-b:a", "128k", "-shortest",
    "-movflags", "+faststart", screenMp4,
  ]);

  // 2. Captions: each cue shows until the next one (an empty cue clears the band).
  const captions = cues
    .map((c, i) => ({
      text: c.text,
      start: Math.max(0, c.t - t0),
      end: Math.min(duration, i + 1 < cues.length ? cues[i + 1].t - t0 : duration),
    }))
    .filter((c) => c.text && c.end - c.start > 0.3);

  fs.writeFileSync(
    path.join(FINAL, `${scene}.${meta.lang}.srt`),
    captions.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join("\n"),
  );

  // 3. The Reel: background + rounded screen + fading captions.
  await drawCards(work, meta.accent, captions);
  const len = duration.toFixed(3);
  const inputs = [
    "-loop", "1", "-framerate", "30", "-t", len, "-i", path.join(work, "bg.png"),
    "-i", screenMp4,
    "-loop", "1", "-framerate", "30", "-t", len, "-i", path.join(work, "mask.png"),
  ];
  const filters = [
    `[1:v]scale=${SCREEN.w}:${SCREEN.h}:flags=lanczos,format=rgba[s]`,
    `[2:v]format=gray[m]`,
    `[s][m]alphamerge[sr]`,
    `[0:v][sr]overlay=${SCREEN.x}:${SCREEN.y}:shortest=1[v0]`,
  ];
  captions.forEach((c, i) => {
    inputs.push("-loop", "1", "-framerate", "30", "-t", len, "-i", path.join(work, `cap-${i}.png`));
    const fadeOut = Math.max(c.start, c.end - FADE).toFixed(3);
    filters.push(
      `[${3 + i}:v]format=rgba,fade=t=in:st=${c.start.toFixed(3)}:d=${FADE}:alpha=1,fade=t=out:st=${fadeOut}:d=${FADE}:alpha=1[c${i}]`,
      `[v${i}][c${i}]overlay=0:${CAPTION.y}[v${i + 1}]`,
    );
  });
  filters.push(`[v${captions.length}]format=yuv420p[out]`);
  const reelMp4 = path.join(FINAL, `${scene}.reel.${meta.lang}.mp4`);
  ffmpeg([
    ...inputs,
    "-filter_complex", filters.join(";"),
    "-map", "[out]", "-map", "1:a", "-r", "30", "-c:v", "libx264", "-preset", "slow", "-crf", "18",
    "-c:a", "copy", "-movflags", "+faststart", reelMp4,
  ]);

  // 4. Poster: a frame from the middle.
  ffmpeg(["-ss", (duration / 2).toFixed(2), "-i", reelMp4, "-frames:v", "1", "-q:v", "3", path.join(FINAL, `${scene}.poster.jpg`)]);

  console.log(`${scene}: ${duration.toFixed(1)} s, ${log.frames.length} frames, ${captions.length} captions → ${path.relative(ROOT, FINAL)}`);
}

if (!fs.existsSync(RAW)) {
  console.error("Nothing recorded yet: run `npm run demo:record` first.");
  process.exit(1);
}
for (const scene of fs.readdirSync(RAW)) {
  if (only && scene !== only) continue;
  for (const project of fs.readdirSync(path.join(RAW, scene))) {
    const dir = path.join(RAW, scene, project);
    if (!fs.existsSync(path.join(dir, "frames.json"))) continue;
    // One project today (phone); a second one gets its own suffix.
    await renderOne(dir, project === "phone" ? scene : `${scene}.${project}`);
  }
}
