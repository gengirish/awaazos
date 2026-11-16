"use client";

import { useState } from "react";
import { PlayCircle } from "lucide-react";

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
 * "Watch · 40 s" under a Help topic, opening the film in a sheet.
 *
 * Nothing is fetched until the tap: the <video> exists only while the sheet is
 * open, so the Help page costs no data for films nobody plays. The captions
 * are burned into the picture; the transcript under it is for screen readers
 * and for reading without sound.
 */
export function HelpVideoButton({
  video,
  showTitle = false,
}: {
  video: ResolvedHelpVideo;
  /** Name the film on the button: needed where one topic offers two. */
  showTitle?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const length = formatVideoLength(video.seconds);

  return (
    <ResponsiveDialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Watch: ${video.title}, ${length}`}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-left text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      >
        <PlayCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span>{showTitle ? `Watch: ${video.title} · ${length}` : `Watch · ${length}`}</span>
      </button>
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
