import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PainReelCard } from "@/components/marketing/PainReelCard";
import { Button } from "@/components/ui/button";
import { BRAND_NAME } from "@/lib/brand";
import { env } from "@/lib/env";
import { formatVideoLength } from "@/lib/help-videos";
import { painReelById, painReelIds, painReelsFor } from "@/lib/pain-reels";
import { PLAN_MARKETING, TRIAL_THEN_NOTE } from "@/lib/plan-copy";

/**
 * A pain-point Reel's own page (lib/pain-reels.ts): the link we post on WhatsApp,
 * in a story or a bio, so it opens a player with a sign-up button and previews
 * with the hook card, not a bare .mp4. Built at deploy time, one per Reel; any
 * other id is a 404, and so is every id while PAIN_REEL_BASE_URL is unset.
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return painReelIds().map((id) => ({ id }));
}

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const reel = painReelById(id, env.PAIN_REEL_BASE_URL);
  if (!reel) return {};
  const title = `${reel.hook} | ${BRAND_NAME}`;
  return {
    title,
    description: reel.sub,
    openGraph: {
      title,
      description: reel.sub,
      type: "video.other",
      images: [{ url: reel.poster, width: 540, height: 960 }],
      videos: [{ url: reel.src, type: "video/mp4", width: 720, height: 1280 }],
    },
    twitter: { card: "summary_large_image", title, description: reel.sub, images: [reel.poster] },
  };
}

export default async function PainReelPage({ params }: Props) {
  const { id } = await params;
  const reel = painReelById(id, env.PAIN_REEL_BASE_URL);
  if (!reel) notFound();
  const more = painReelsFor(reel.store, env.PAIN_REEL_BASE_URL).filter((r) => r.id !== reel.id);

  return (
    <div className="px-4 py-10 sm:px-6 sm:py-14">
      <article aria-labelledby="reel-heading" className="mx-auto grid max-w-5xl gap-8 md:grid-cols-[auto_1fr] md:items-start">
        {/* A 9:16 phone film: as tall as the screen allows, never wider than it. Nothing but
            the poster loads until it is played. */}
        <video
          src={reel.src}
          poster={reel.poster}
          controls
          playsInline
          preload="none"
          className="mx-auto block aspect-[9/16] max-h-[78dvh] w-full max-w-sm rounded-xl bg-black md:mx-0"
        >
          <a href={reel.src}>Open the video</a>
        </video>

        <div>
          <h1
            id="reel-heading"
            lang="hi-Latn"
            className="font-display text-3xl font-bold text-balance text-awaaz-charcoal sm:text-4xl"
          >
            {reel.hook}
          </h1>
          <p className="mt-3 text-lg text-muted-foreground">{reel.sub}</p>
          <p className="mt-1 text-sm text-muted-foreground">{formatVideoLength(reel.seconds)} video</p>

          <div className="mt-6">
            <Button asChild size="lg" className="min-h-12 w-full px-8 text-base font-semibold sm:w-auto">
              <Link href="/sign-up">{PLAN_MARKETING.STARTER.cta}</Link>
            </Button>
            <p className="mt-2 text-sm text-muted-foreground">{TRIAL_THEN_NOTE}</p>
          </div>

          <details className="mt-6 text-sm">
            <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-foreground">
              What the video says
            </summary>
            <ol className="mt-1 list-decimal space-y-1 pl-5 text-muted-foreground">
              {reel.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ol>
          </details>
        </div>
      </article>

      {more.length > 0 ? (
        <section aria-labelledby="more-heading" className="mx-auto mt-14 max-w-5xl">
          <h2 id="more-heading" className="font-display text-2xl font-bold text-awaaz-charcoal">
            More videos
          </h2>
          <ul className="mt-4 flex snap-x snap-mandatory gap-4 overflow-x-auto pb-3">
            {more.map((r) => (
              <li key={r.id} className="snap-start">
                <PainReelCard reel={r} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
