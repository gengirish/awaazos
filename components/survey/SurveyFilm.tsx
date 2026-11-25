"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { formatVideoLength, type ResolvedHelpVideo } from "@/lib/help-videos";
import { painLabel } from "@/lib/owner-survey";
import { painReelPath, type ResolvedPainReel } from "@/lib/pain-reels";
import { PLAN_MARKETING, TRIAL_THEN_NOTE } from "@/lib/plan-copy";

/** A 9:16 phone film; nothing but the poster loads until it is played. */
function Film({ src, poster, className }: { src: string; poster: string; className: string }) {
  return (
    <video src={src} poster={poster} controls playsInline preload="none" className={`block aspect-[9/16] rounded-xl bg-black ${className}`}>
      <a href={src}>Open the video</a>
    </video>
  );
}

const OTHER_ROW: Record<ResolvedPainReel["store"], string> = {
  kitchen: "Run a home kitchen?",
  jewellery: "Sell jewellery or other products?",
  clothing: "Sell clothes?",
};

/** Each link names its own store, so two of them never read the same to a screen reader. */
const OTHER_LINK: Record<ResolvedPainReel["store"], string> = {
  kitchen: "Watch the kitchen version",
  jewellery: "Watch the jewellery version",
  clothing: "Watch the clothing version",
};

/**
 * Public /survey, once sent: the Reel for the problem that hurts most, and the way to
 * start a store. Shows the visitor only their own answer back. Focus moves to the
 * heading, because the form it replaces is gone.
 */
export function SurveyReelThanks({ pain, reels }: { pain: string; reels: readonly ResolvedPainReel[] }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const [reel, ...others] = reels;

  return (
    <section aria-labelledby="survey-thanks" className="space-y-4">
      <h2
        id="survey-thanks"
        ref={heading}
        tabIndex={-1}
        className="font-display text-2xl font-semibold text-foreground focus:outline-hidden"
      >
        Thank you. We read every answer.
      </h2>
      {reel ? (
        <>
          <p className="text-sm text-muted-foreground">
            Here&apos;s how sellers fix &ldquo;{painLabel(pain)}&rdquo;:
          </p>
          <Film src={reel.src} poster={reel.poster} className="w-full max-w-[14rem]" />
          <div>
            <p lang="hi-Latn" className="font-semibold text-foreground">
              {reel.hook}
            </p>
            <p className="text-sm text-muted-foreground">
              {reel.sub} · {formatVideoLength(reel.seconds)}
            </p>
          </div>
          {others.map((other) => (
            <p key={other.id} className="text-sm text-muted-foreground">
              {OTHER_ROW[other.store]}{" "}
              <Link
                href={painReelPath(other.id)}
                className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4"
              >
                {OTHER_LINK[other.store]}
              </Link>
            </p>
          ))}
          <div>
            <Button asChild size="lg" className="min-h-12 w-full px-8 text-base font-semibold sm:w-auto">
              <Link href="/sign-up">{PLAN_MARKETING.STARTER.cta}</Link>
            </Button>
            <p className="mt-2 text-sm text-muted-foreground">{TRIAL_THEN_NOTE}</p>
          </div>
        </>
      ) : null}
    </section>
  );
}

/**
 * Settings → Tell us what's hard, once saved: this seller already has the product, so the
 * answer is the Help film for the same job, not a sign-up Reel.
 */
export function SurveyHelpFilm({ pain, film }: { pain: string; film: ResolvedHelpVideo }) {
  return (
    <section aria-labelledby="survey-help-film" className="space-y-3 rounded-lg border bg-muted/40 p-4">
      <h3 id="survey-help-film" className="font-semibold text-foreground">
        For &ldquo;{painLabel(pain)}&rdquo;: {film.title}
      </h3>
      <Film src={film.src} poster={film.poster} className="w-full max-w-[14rem]" />
      <p className="text-sm text-muted-foreground">
        {formatVideoLength(film.seconds)} video.{" "}
        <Link href="/help" className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4">
          More videos in Help
        </Link>
      </p>
    </section>
  );
}
