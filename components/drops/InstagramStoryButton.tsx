"use client";

import { Download, Instagram, Loader2 } from "lucide-react";
import { useState } from "react";

import { AiImagePromptForm } from "@/components/ai/AiImagePromptForm";
import { AI_IMAGES_ENABLED, aiImageErrorMessage } from "@/lib/ai-image-types";
import { withInstagramTag } from "@/lib/order-channel";
import { cn } from "@/lib/utils";

type StoryOptions = {
  /** Same-origin PNG endpoint: a drop's or the whole store's story image. */
  src: string;
  /** Name of the downloaded / shared file. */
  fileName: string;
  /** Storefront link, copied for the vendor to paste into Instagram's Link sticker. */
  url: string;
  onStatus: (message: string) => void;
};

type Props = StoryOptions & { className: string };

export type StoryImage = { file: File; objectUrl: string };

/**
 * Two taps on purpose: the first fetches the story PNG, the second hands it to
 * the share sheet. iOS Safari drops the user gesture across an `await fetch`,
 * so calling navigator.share right after the download would throw
 * NotAllowedError. Browsers that can't share files get a plain download.
 *
 * A hook so the orders board's Share menu can run the same flow from menu items.
 * Keep the caller mounted between the two taps: the prepared image lives here.
 */
export function useInstagramStory({ src, fileName, url, onStatus }: StoryOptions) {
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState<StoryImage | null>(null);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(withInstagramTag(url));
      return true;
    } catch {
      return false;
    }
  }

  function download(r: StoryImage) {
    const a = document.createElement("a");
    a.href = r.objectUrl;
    a.download = r.file.name;
    a.click();
  }

  /** With a prompt, the same image over an AI background (POST on the same route). */
  async function prepare(prompt?: string) {
    onStatus("");
    setLoading(true);
    // Clipboard first, while the tap still counts as a user gesture.
    const copied = await copyLink();
    try {
      const res = await fetch(
        src,
        prompt
          ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) }
          : undefined,
      );
      if (!res.ok) {
        if (prompt) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          onStatus(aiImageErrorMessage(data.error, res.status));
          return;
        }
        throw new Error(String(res.status));
      }
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

  async function share(r: StoryImage) {
    try {
      await navigator.share({ files: [r.file] });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return; // vendor dismissed the sheet
      download(r);
    }
  }

  return { ready, loading, prepare, share, download };
}

export function InstagramStoryButton({ src, fileName, url, className, onStatus }: Props) {
  const { ready, loading, prepare, share, download } = useInstagramStory({ src, fileName, url, onStatus });

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
    <>
      <button
        type="button"
        onClick={() => prepare()}
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
      {AI_IMAGES_ENABLED ? (
        <details className="w-full basis-full">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium">
            Story with an AI background
          </summary>
          <AiImagePromptForm
            label="Describe the background"
            placeholder="Warm morning light on a wooden table"
            submitLabel="Make story image"
            busy={loading}
            onSubmit={(prompt) => void prepare(prompt)}
          />
        </details>
      ) : null}
    </>
  );
}
