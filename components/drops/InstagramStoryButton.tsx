"use client";

import { Download, Instagram, Loader2 } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

type Props = {
  /** Same-origin PNG endpoint: a drop's or the whole store's story image. */
  src: string;
  /** Name of the downloaded / shared file. */
  fileName: string;
  /** Storefront link, copied for the vendor to paste into Instagram's Link sticker. */
  url: string;
  className: string;
  onStatus: (message: string) => void;
  /**
   * A prepared image kept by a parent that outlives this button. The orders
   * board puts the share controls in a bottom sheet, which unmounts when it
   * closes; without this, closing the sheet between the two taps would throw
   * the downloaded image away and ask for it again.
   */
  story?: StoryImage | null;
  onStory?: (story: StoryImage) => void;
};

export type StoryImage = { file: File; objectUrl: string };
type Ready = StoryImage;

/**
 * Two taps on purpose: the first fetches the story PNG, the second hands it to
 * the share sheet. iOS Safari drops the user gesture across an `await fetch`,
 * so calling navigator.share right after the download would throw
 * NotAllowedError. Browsers that can't share files get a plain download.
 */
export function InstagramStoryButton({ src, fileName, url, className, onStatus, story, onStory }: Props) {
  const [loading, setLoading] = useState(false);
  const [ownReady, setOwnReady] = useState<Ready | null>(null);
  const ready = ownReady ?? story ?? null;
  const setReady = (r: Ready) => {
    setOwnReady(r);
    onStory?.(r);
  };

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      return true;
    } catch {
      return false;
    }
  }

  function download(r: Ready) {
    const a = document.createElement("a");
    a.href = r.objectUrl;
    a.download = r.file.name;
    a.click();
  }

  async function prepare() {
    onStatus("");
    setLoading(true);
    // Clipboard first, while the tap still counts as a user gesture.
    const copied = await copyLink();
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const file = new File([blob], fileName, { type: "image/png" });
      const r = { file, objectUrl: URL.createObjectURL(blob) };
      const linkNote = copied ? " Link copied — paste it into a Link sticker." : "";
      if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        setReady(r);
        onStatus(`Story image ready.${linkNote}`);
      } else {
        download(r);
        onStatus(`Story image downloaded.${linkNote}`);
      }
    } catch {
      onStatus("Couldn't make the story image. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function share(r: Ready) {
    try {
      await navigator.share({ files: [r.file] });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return; // vendor dismissed the sheet
      download(r);
    }
  }

  if (ready) {
    return (
      <>
        <button type="button" onClick={() => share(ready)} className={cn(className, "bg-primary text-primary-foreground hover:bg-primary/90")}>
          <Instagram className="h-4 w-4" aria-hidden="true" />
          Share story image
        </button>
        <button
          type="button"
          onClick={() => download(ready)}
          aria-label="Download story image"
          className={cn(className, "border border-border bg-background text-foreground hover:bg-muted")}
        >
          <Download className="h-4 w-4" aria-hidden="true" />
        </button>
      </>
    );
  }

  return (
    <button
      type="button"
      onClick={prepare}
      disabled={loading}
      className={cn(className, "flex-1 border border-border bg-background text-foreground hover:bg-muted")}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        <Instagram className="h-4 w-4" aria-hidden="true" />
      )}
      Instagram story
    </button>
  );
}
