import Link from "next/link";
import { Play } from "lucide-react";

import { formatVideoLength } from "@/lib/help-videos";
import { painReelPath, type ResolvedPainReel } from "@/lib/pain-reels";

/**
 * One pain-point Reel as a poster card: the hook card picture, the plain title and
 * the length. A plain link to the Reel's page (/v/<id>), so a page full of them
 * ships no player script and fetches only the posters, lazily.
 */
export function PainReelCard({ reel }: { reel: ResolvedPainReel }) {
  return (
    <Link
      href={painReelPath(reel.id)}
      className="group block w-40 rounded-xl focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:w-44"
    >
      <span className="relative block overflow-hidden rounded-xl bg-muted">
        {/* A plain <img>: the poster is already sized for phones (540 px wide), and lazy keeps off-screen ones unloaded. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={reel.poster}
          alt=""
          width={540}
          height={960}
          loading="lazy"
          decoding="async"
          className="aspect-[9/16] h-auto w-full object-cover motion-safe:transition-transform motion-safe:group-hover:scale-[1.02]"
        />
        <span
          aria-hidden="true"
          className="absolute bottom-2 left-2 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white"
        >
          <Play className="h-4 w-4" />
        </span>
      </span>
      <span className="mt-2 block text-sm font-semibold text-foreground">{reel.title}</span>
      <span className="block text-xs text-muted-foreground">{formatVideoLength(reel.seconds)}</span>
    </Link>
  );
}
