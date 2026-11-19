/**
 * Render the pain-point Reels (content/pain-reels/reels.ts).
 *
 *   npm run pain-reels:render -- --from=<folder of voiced films>
 *   npm run pain-reels:render -- --from=<folder> --only=jewellery-overselling
 *
 * Options: --from (default demo-output/final), --voice (default hf_beta),
 * --out (default demo-output/pain-reels), --only (one Reel id).
 *
 * Reads `<from>/<film>.reel.en.<voice>.mp4` and `<film>.poster.jpg`, the output of
 * the demo-video pipeline (docs/DEMO_VIDEOS_PLAN.md). For each Reel it writes
 * `<out>/<id>.mp4` (1080 × 1920, 30 fps, ready for Instagram and WhatsApp Status)
 * and `<out>/<id>.cover.jpg` (the hook card, to pick as the Reel's cover).
 *
 * The cards are drawn by headless Chrome in the films' own style (Baloo 2 on the
 * store colour), then joined with ffmpeg. ffmpeg must be on PATH, or FFMPEG=<path>.
 * The films show demo data only, so the Reels are safe to post.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { chromium } from "@playwright/test";

import { PAIN_REELS, type PainReel } from "@/content/pain-reels/reels";
import { BRAND_NAME } from "@/lib/brand";
import { TRIAL_DAYS } from "@/lib/constants";
import { OWNER_PAINS } from "@/lib/owner-survey";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

const FROM = path.resolve(arg("from") ?? "demo-output/final");
const VOICE = arg("voice") ?? "hf_beta";
const OUT = path.resolve(arg("out") ?? "demo-output/pain-reels");
const ONLY = arg("only");
const FFMPEG = process.env.FFMPEG || "ffmpeg";

const W = 1080;
const H = 1920;
/** Long enough to read the hook twice, short enough that nobody swipes away. */
const HOOK_S = 2.4;
const END_S = 3;
const FADE_S = 0.25;
/** The store colour each film was recorded in: the meals demo store is green, the jewellery one red. */
const ACCENT: Record<PainReel["store"], string> = { kitchen: "#157f3c", jewellery: "#b91c1c" };
const SITE = "awaazdo.store";

const FONTS =
  '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
  '<link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;800&display=block" rel="stylesheet">';

const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

function ffmpeg(argv: string[]) {
  execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...argv], { stdio: "inherit" });
}

const gradient = (accent: string) =>
  `radial-gradient(120% 70% at 50% 0%, color-mix(in srgb, ${accent} 70%, white) 0%, ${accent} 55%, color-mix(in srgb, ${accent} 70%, black) 100%)`;

function hookHtml(reel: PainReel, posterDataUri: string): string {
  const accent = ACCENT[reel.store];
  return `<div style="position:relative;width:${W}px;height:${H}px;overflow:hidden;background:${gradient(accent)}">
    <img src="${posterDataUri}" style="position:absolute;left:-140px;top:-520px;width:${W + 280}px;height:${H + 520 + 120}px;object-fit:cover;object-position:50% 100%;filter:blur(12px) saturate(1.1)">
    <div style="position:absolute;inset:0;background:linear-gradient(180deg, color-mix(in srgb, ${accent} 55%, rgba(0,0,0,.55)) 0%, rgba(0,0,0,.62) 45%, color-mix(in srgb, ${accent} 45%, rgba(0,0,0,.7)) 100%)"></div>
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;box-sizing:border-box;padding:0 84px;gap:44px">
      <p style="margin:0;font:800 104px/1.08 'Baloo 2',system-ui,sans-serif;color:#fff;text-wrap:balance;text-shadow:0 4px 24px rgba(0,0,0,.45)">${escapeHtml(reel.hook)}</p>
      <div style="width:160px;height:12px;border-radius:6px;background:${accent};box-shadow:0 0 0 3px rgba(255,255,255,.85)"></div>
      <p style="margin:0;font:600 58px/1.2 'Baloo 2',system-ui,sans-serif;color:#fff;opacity:.95;text-wrap:balance;text-shadow:0 3px 14px rgba(0,0,0,.45)">${escapeHtml(reel.sub)}</p>
    </div>
  </div>`;
}

function endHtml(accent: string): string {
  return `<div style="width:${W}px;height:${H}px;background:${gradient(accent)};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:36px;box-sizing:border-box;padding:0 80px;text-align:center;color:#fff;font-family:'Baloo 2',system-ui,sans-serif">
    <p style="margin:0;font-weight:800;font-size:72px;letter-spacing:.5px;opacity:.9">${BRAND_NAME}</p>
    <p style="margin:0;font-weight:800;font-size:116px;line-height:1.05;text-wrap:balance;text-shadow:0 4px 20px rgba(0,0,0,.3)">Apna store, ${TRIAL_DAYS} din free</p>
    <p style="margin:0;font-weight:600;font-size:54px;opacity:.95">No card needed. No commission.</p>
    <p style="margin:24px 0 0;font-weight:800;font-size:52px;background:#fff;color:${accent};padding:18px 44px;border-radius:999px">${SITE}</p>
  </div>`;
}

async function drawCards(reels: PainReel[], work: string) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    const shot = async (html: string, file: string) => {
      await page.setContent(`<!doctype html><html><head>${FONTS}<style>html,body{margin:0}</style></head><body>${html}</body></html>`, {
        waitUntil: "networkidle",
      });
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: file, type: file.endsWith(".jpg") ? "jpeg" : "png", quality: file.endsWith(".jpg") ? 90 : undefined });
    };
    for (const store of new Set(reels.map((r) => r.store))) await shot(endHtml(ACCENT[store]), path.join(work, `end-${store}.png`));
    for (const reel of reels) {
      const poster = fs.readFileSync(path.join(FROM, `${reel.film}.poster.jpg`)).toString("base64");
      await shot(hookHtml(reel, `data:image/jpeg;base64,${poster}`), path.join(work, `${reel.id}.hook.png`));
    }
  } finally {
    await browser.close();
  }
}

function renderOne(reel: PainReel, work: string) {
  const film = path.join(FROM, `${reel.film}.reel.en.${VOICE}.mp4`);
  const hook = path.join(work, `${reel.id}.hook.png`);
  const end = path.join(work, `end-${reel.store}.png`);
  const out = path.join(OUT, `${reel.id}.mp4`);
  const v = "fps=30,scale=1080:1920:flags=lanczos,setsar=1,format=yuv420p";
  const a = "aformat=sample_rates=48000:channel_layouts=mono";
  ffmpeg([
    "-loop", "1", "-framerate", "30", "-t", String(HOOK_S), "-i", hook,
    "-i", film,
    "-loop", "1", "-framerate", "30", "-t", String(END_S), "-i", end,
    "-f", "lavfi", "-t", String(HOOK_S), "-i", "anullsrc=r=48000:cl=mono",
    "-f", "lavfi", "-t", String(END_S), "-i", "anullsrc=r=48000:cl=mono",
    "-filter_complex",
    [
      `[0:v]${v},fade=t=out:st=${HOOK_S - FADE_S}:d=${FADE_S}[v0]`,
      `[1:v]${v},fade=t=in:st=0:d=${FADE_S}[v1]`,
      `[2:v]${v},fade=t=in:st=0:d=${FADE_S}[v2]`,
      `[3:a]${a}[a0]`,
      `[1:a]${a}[a1]`,
      `[4:a]${a}[a2]`,
      `[v0][a0][v1][a1][v2][a2]concat=n=3:v=1:a=1[v][a]`,
    ].join(";"),
    "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-profile:v", "high",
    "-c:a", "aac", "-b:a", "128k",
    "-movflags", "+faststart",
    out,
  ]);
  ffmpeg(["-i", hook, "-q:v", "3", path.join(OUT, `${reel.id}.cover.jpg`)]);
  return out;
}

async function main() {
  const known = new Set<string>(OWNER_PAINS.map((p) => p.key));
  const bad = PAIN_REELS.filter((r) => r.pain !== null && !known.has(r.pain)).map((r) => r.pain);
  if (bad.length > 0) throw new Error(`Not survey pains: ${bad.join(", ")}`);
  const ids = PAIN_REELS.map((r) => r.id);
  if (new Set(ids).size !== ids.length) throw new Error("Two Reels share an id");

  const reels = PAIN_REELS.filter((r) => !ONLY || r.id === ONLY);
  if (reels.length === 0) throw new Error(`No Reel for --only=${ONLY}`);
  const missing = reels.filter(
    (r) =>
      !fs.existsSync(path.join(FROM, `${r.film}.reel.en.${VOICE}.mp4`)) ||
      !fs.existsSync(path.join(FROM, `${r.film}.poster.jpg`)),
  );
  if (missing.length > 0) {
    console.error(`Not in ${FROM}: ${missing.map((r) => r.film).join(", ")}. Record and voice them first, or pass --from.`);
    process.exit(1);
  }

  const work = path.join(OUT, ".cards");
  fs.mkdirSync(work, { recursive: true });
  await drawCards(reels, work);
  for (const reel of reels) {
    console.log(`${reel.id} (${reel.film})…`);
    const out = renderOne(reel, work);
    console.log(`  ${Math.round(fs.statSync(out).size / 1024)} KB → ${out}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
