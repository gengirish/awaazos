/**
 * Publish the Help page's films (lib/help-videos.ts) to the public Blob store.
 *
 *   npm run help-videos:publish -- --from=<folder of voiced reels>             # dry run: encode only
 *   npm run help-videos:publish -- --from=<folder of voiced reels> --upload    # encode, then upload
 *
 * Options: --from (default demo-output/final), --voice (default hf_beta),
 * --out (default demo-output/help-videos), --upload.
 *
 * Reads `<from>/<id>.reel.en.<voice>.mp4` and `<from>/<id>.poster.jpg`, the
 * output of the demo-video pipeline (docs/DEMO_VIDEOS_PLAN.md), for every film
 * in HELP_VIDEOS. Each is re-encoded for phones on mobile data: 720 × 1280,
 * H.264 with the index at the front (plays while it downloads), 96 kbps AAC,
 * and the poster shrunk to 540 px wide. ffmpeg must be on PATH.
 *
 * --upload puts them at help-videos/<id>.mp4 and .jpg in the store that
 * BLOB_READ_WRITE_TOKEN opens, overwriting the last version, and prints the
 * folder to set as HELP_VIDEO_BASE_URL on Vercel. These files are public: anyone
 * with the link can watch them, so publish only films that show demo data.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { put } from "@vercel/blob";

import { HELP_VIDEOS } from "@/lib/help-videos";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

const FROM = path.resolve(arg("from") ?? "demo-output/final");
const VOICE = arg("voice") ?? "hf_beta";
const OUT = path.resolve(arg("out") ?? "demo-output/help-videos");
const UPLOAD = process.argv.includes("--upload");
const BLOB_FOLDER = "help-videos";

function ffmpeg(args: string[]) {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
}

function encode(): { file: string; key: string; contentType: string }[] {
  fs.mkdirSync(OUT, { recursive: true });
  const files: { file: string; key: string; contentType: string }[] = [];
  const missing: string[] = [];
  for (const video of HELP_VIDEOS) {
    const reel = path.join(FROM, `${video.id}.reel.en.${VOICE}.mp4`);
    const poster = path.join(FROM, `${video.id}.poster.jpg`);
    if (!fs.existsSync(reel) || !fs.existsSync(poster)) {
      missing.push(video.id);
      continue;
    }
    const mp4 = path.join(OUT, `${video.id}.mp4`);
    const jpg = path.join(OUT, `${video.id}.jpg`);
    console.log(`${video.id}: encoding…`);
    ffmpeg([
      "-i", reel,
      "-vf", "scale=720:1280:flags=lanczos,format=yuv420p",
      "-c:v", "libx264", "-preset", "slow", "-crf", "26", "-profile:v", "high",
      "-c:a", "aac", "-b:a", "96k", "-ac", "1",
      "-movflags", "+faststart",
      mp4,
    ]);
    ffmpeg(["-i", poster, "-vf", "scale=540:-2:flags=lanczos", "-q:v", "4", jpg]);
    const kb = (f: string) => Math.round(fs.statSync(f).size / 1024);
    console.log(`  ${kb(mp4)} KB video, ${kb(jpg)} KB poster`);
    files.push({ file: mp4, key: `${BLOB_FOLDER}/${video.id}.mp4`, contentType: "video/mp4" });
    files.push({ file: jpg, key: `${BLOB_FOLDER}/${video.id}.jpg`, contentType: "image/jpeg" });
  }
  if (missing.length > 0) {
    console.error(`\nNot in ${FROM}: ${missing.join(", ")}. Record and voice them first, or pass --from.`);
    process.exit(1);
  }
  return files;
}

async function upload(files: { file: string; key: string; contentType: string }[]) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error("BLOB_READ_WRITE_TOKEN is not set: export the public store's token to upload.");
    process.exit(1);
  }
  let folder = "";
  for (const f of files) {
    const blob = await put(f.key, fs.readFileSync(f.file), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: f.contentType,
      // A re-recorded film keeps its URL; a day's cache lets the new one through soon.
      cacheControlMaxAge: 86_400,
    });
    folder = blob.url.slice(0, blob.url.lastIndexOf("/"));
    console.log(`  ↑ ${blob.url}`);
  }
  console.log(`\nSet on Vercel (Production): HELP_VIDEO_BASE_URL=${folder}`);
}

async function main() {
  const files = encode();
  const totalKb = Math.round(files.reduce((n, f) => n + fs.statSync(f.file).size, 0) / 1024);
  console.log(`\n${files.length / 2} films, ${totalKb} KB in ${path.relative(process.cwd(), OUT) || OUT}`);
  if (UPLOAD) await upload(files);
  else console.log("Dry run: nothing uploaded. Add --upload to publish them.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
