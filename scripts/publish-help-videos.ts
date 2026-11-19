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
 * in HELP_VIDEOS. Encoding and upload: scripts/lib/publish-videos.ts. --upload puts
 * them at help-videos/<id>.mp4 and .jpg and prints the folder to set as
 * HELP_VIDEO_BASE_URL on Vercel.
 */
import path from "node:path";

import { HELP_VIDEOS } from "@/lib/help-videos";

import { arg, encodeFilms, publishFiles } from "./lib/publish-videos";

const FROM = path.resolve(arg("from") ?? "demo-output/final");
const VOICE = arg("voice") ?? "hf_beta";
const OUT = path.resolve(arg("out") ?? "demo-output/help-videos");

async function main() {
  const films = HELP_VIDEOS.map((v) => ({
    id: v.id,
    video: path.join(FROM, `${v.id}.reel.en.${VOICE}.mp4`),
    poster: path.join(FROM, `${v.id}.poster.jpg`),
  }));
  const files = encodeFilms(films, OUT, "help-videos", FROM);
  await publishFiles(files, OUT, process.argv.includes("--upload"), "HELP_VIDEO_BASE_URL");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
