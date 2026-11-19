/**
 * Shared by the scripts that publish films to the public Blob store: the Help
 * page's films (scripts/publish-help-videos.ts) and the pain-point Reels
 * (scripts/publish-pain-reels.ts).
 *
 * Each film is re-encoded for phones on mobile data: 720 × 1280, H.264 with the
 * index at the front (plays while it downloads), 96 kbps mono AAC, and its
 * poster shrunk to 540 px wide. ffmpeg must be on PATH.
 *
 * Uploads go to `<folder>/<id>.mp4` and `.jpg` in the store BLOB_READ_WRITE_TOKEN
 * opens, overwriting the last version. These files are public: anyone with the
 * link can watch them, so publish only films that show demo data.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { put } from "@vercel/blob";

export type FilmSource = { id: string; video: string; poster: string };
export type EncodedFile = { file: string; key: string; contentType: string };

export function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

function ffmpeg(args: string[]) {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
}

/** Encode every film into `out`; exits listing the missing ones if any source is absent. */
export function encodeFilms(films: readonly FilmSource[], out: string, folder: string, from: string): EncodedFile[] {
  fs.mkdirSync(out, { recursive: true });
  const files: EncodedFile[] = [];
  const missing = films.filter((f) => !fs.existsSync(f.video) || !fs.existsSync(f.poster)).map((f) => f.id);
  if (missing.length > 0) {
    console.error(`Not in ${from}: ${missing.join(", ")}. Render them first, or pass --from.`);
    process.exit(1);
  }
  for (const film of films) {
    const mp4 = path.join(out, `${film.id}.mp4`);
    const jpg = path.join(out, `${film.id}.jpg`);
    console.log(`${film.id}: encoding…`);
    ffmpeg([
      "-i", film.video,
      "-vf", "scale=720:1280:flags=lanczos,format=yuv420p",
      "-c:v", "libx264", "-preset", "slow", "-crf", "26", "-profile:v", "high",
      "-c:a", "aac", "-b:a", "96k", "-ac", "1",
      "-movflags", "+faststart",
      mp4,
    ]);
    ffmpeg(["-i", film.poster, "-vf", "scale=540:-2:flags=lanczos", "-q:v", "4", jpg]);
    const kb = (f: string) => Math.round(fs.statSync(f).size / 1024);
    console.log(`  ${kb(mp4)} KB video, ${kb(jpg)} KB poster`);
    files.push({ file: mp4, key: `${folder}/${film.id}.mp4`, contentType: "video/mp4" });
    files.push({ file: jpg, key: `${folder}/${film.id}.jpg`, contentType: "image/jpeg" });
  }
  return files;
}

/** Upload, or say it was a dry run; prints the folder URL to set as `envName` on Vercel. */
export async function publishFiles(files: readonly EncodedFile[], out: string, upload: boolean, envName: string) {
  const totalKb = Math.round(files.reduce((n, f) => n + fs.statSync(f.file).size, 0) / 1024);
  console.log(`\n${files.length / 2} films, ${totalKb} KB in ${path.relative(process.cwd(), out) || out}`);
  if (!upload) {
    console.log("Dry run: nothing uploaded. Add --upload to publish them.");
    return;
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error("BLOB_READ_WRITE_TOKEN is not set: export the public store's token to upload.");
    process.exit(1);
  }
  let folderUrl = "";
  for (const f of files) {
    const blob = await put(f.key, fs.readFileSync(f.file), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: f.contentType,
      // A re-recorded film keeps its URL; a day's cache lets the new one through soon.
      cacheControlMaxAge: 86_400,
    });
    folderUrl = blob.url.slice(0, blob.url.lastIndexOf("/"));
    console.log(`  ↑ ${blob.url}`);
  }
  console.log(`\nSet on Vercel (Production): ${envName}=${folderUrl}`);
}
