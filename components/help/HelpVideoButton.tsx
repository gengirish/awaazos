"use client";

import { useState } from "react";
import { Play, PlayCircle } from "lucide-react";

import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { formatVideoLength, type ResolvedHelpVideo } from "@/lib/help-videos";

/**
 * A Help film and the sheet it plays in. Two looks for the trigger:
 * `link` is "Watch · 40 s" inside a topic's answer; `card` is a poster tile for
 * the row of films at the top of the page.
 *
 * Nothing but the poster is fetched until the tap: the <video> exists only while
 * the sheet is open, so the Help page costs no data for films nobody plays. The
 * captions are burned into the picture; the transcript under it is for screen
 * readers and for reading without sound.
 */
export function HelpVideoButton({
  video,
  showTitle = false,
  variant = "link",
}: {
  video: ResolvedHelpVideo;
  /** Name the film on a link: needed where one topic offers two. */
  showTitle?: boolean;
  variant?: "link" | "card";
}) {
  const [open, setOpen] = useState(false);
  const length = formatVideoLength(video.seconds);

  return (
    <ResponsiveDialog open={open} onOpenChange={setOpen}>
      {variant === "card" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Watch: ${video.title}, ${length}`}
          className="group flex w-32 shrink-0 snap-start flex-col rounded-lg text-left align-top focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring md:w-36"
        >
          <span className="relative block aspect-[9/16] overflow-hidden rounded-lg border bg-muted">
            {/* A plain <img>: the poster is already sized for phones (540 px wide), and lazy keeps off-screen ones unloaded. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={video.poster}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover transition-transform group-hover:scale-[1.03] motion-reduce:transition-none"
            />
            <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white">
                <Play className="ml-0.5 h-5 w-5 fill-current" />
              </span>
            </span>
            <span
              className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-xs font-semibold text-white"
              aria-hidden="true"
            >
              {length}
            </span>
          </span>
          <span className="mt-1.5 line-clamp-2 block text-sm font-semibold leading-snug text-foreground">
            {video.title}
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Watch: ${video.title}, ${length}`}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-left text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        >
          <PlayCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span>{showTitle ? `Watch: ${video.title} · ${length}` : `Watch · ${length}`}</span>
        </button>
      )}
      <ResponsiveDialogContent className="md:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{video.title}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{length} video with sound and captions.</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody>
          {open ? (
            // A 9:16 phone film: as tall as the sheet allows, never wider than the screen.
            <video
              src={video.src}
              poster={video.poster}
              controls
              autoPlay
              playsInline
              preload="metadata"
              className="mx-auto block aspect-[9/16] max-h-[62dvh] w-auto max-w-full rounded-lg bg-black"
            >
              <a href={video.src}>Open the video</a>
            </video>
          ) : null}
          <details className="mt-3 text-sm">
            <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-foreground">
              What the video says
            </summary>
            <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
              {video.lines.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ol>
          </details>
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
