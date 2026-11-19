/**
 * Publish the pain-point Reels (lib/pain-reels.ts) to the public Blob store.
 *
 *   npm run pain-reels:publish -- --from=<folder of rendered Reels>             # dry run: encode only
 *   npm run pain-reels:publish -- --from=<folder of rendered Reels> --upload    # encode, then upload
 *
 * Options: --from (default demo-output/pain-reels), --out (default
 * demo-output/pain-reels-web), --upload.
 *
 * Reads `<from>/<id>.mp4` and `<from>/<id>.cover.jpg`, the output of
 * `npm run pain-reels:render`, for every Reel in PAIN_REELS; the hook card cover
 * becomes the poster. Encoding and upload: scripts/lib/publish-videos.ts. --upload
 * puts them at pain-reels/<id>.mp4 and .jpg and prints the folder to set as
 * PAIN_REEL_BASE_URL on Vercel (the pages that read it are static: redeploy after).
 */
import path from "node:path";

import { PAIN_REELS } from "@/content/pain-reels/reels";

import { arg, encodeFilms, publishFiles } from "./lib/publish-videos";

const FROM = path.resolve(arg("from") ?? "demo-output/pain-reels");
const OUT = path.resolve(arg("out") ?? "demo-output/pain-reels-web");

async function main() {
  const films = PAIN_REELS.map((r) => ({
    id: r.id,
    video: path.join(FROM, `${r.id}.mp4`),
    poster: path.join(FROM, `${r.id}.cover.jpg`),
  }));
  const files = encodeFilms(films, OUT, "pain-reels", FROM);
  await publishFiles(files, OUT, process.argv.includes("--upload"), "PAIN_REEL_BASE_URL");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
