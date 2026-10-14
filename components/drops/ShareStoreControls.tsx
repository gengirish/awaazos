"use client";

import { Check, Copy, Share2 } from "lucide-react";
import { useEffect, useState } from "react";

import { InstagramStoryButton, type StoryImage } from "@/components/drops/InstagramStoryButton";
import { buildWhatsAppShareUrl } from "@/lib/drops-share";
import { cn } from "@/lib/utils";

const baseBtn =
  "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-60";

/**
 * "Share your store" on the orders board, for sellers who take orders from
 * their everyday menu: the store link (share sheet, else WhatsApp), a copy
 * button, and the store's Instagram story image (GET /api/vendor/story-image).
 * Same shape as ShareDropButton; the prepared image is held by the board so a
 * closed sheet doesn't throw it away (see InstagramStoryButton).
 */
export function ShareStoreControls({
  vendorName,
  vendorSlug,
  story,
  onStory,
}: {
  vendorName: string;
  vendorSlug: string;
  story?: StoryImage | null;
  onStory?: (story: StoryImage) => void;
}) {
  // window is unavailable during SSR; fill the origin in after mount.
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  const url = `${origin}/s/${encodeURIComponent(vendorSlug)}`;
  const text = `Order from ${vendorName}: ${url}`;

  async function share() {
    setStatus("");
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: vendorName, text, url });
        return;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return; // seller dismissed the sheet
        // Share API present but refused: fall through to WhatsApp.
      }
    }
    window.open(buildWhatsAppShareUrl(text), "_blank", "noopener,noreferrer");
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setStatus("Store link copied");
    } catch {
      setStatus("Couldn't copy — use Share instead");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={() => void share()} className={cn(baseBtn, "bg-primary text-primary-foreground hover:bg-primary/90")}>
        <Share2 className="h-4 w-4" aria-hidden="true" />
        Share store link
      </button>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void copy()}
          className={cn(baseBtn, "flex-1 border border-border bg-background text-foreground hover:bg-muted")}
        >
          {copied ? <Check className="h-4 w-4 text-primary" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
          {copied ? "Copied" : "Copy link"}
        </button>
        <InstagramStoryButton
          src="/api/vendor/story-image"
          fileName="store-story.png"
          url={url}
          className={baseBtn}
          onStatus={setStatus}
          story={story}
          onStory={onStory}
        />
      </div>
      <p aria-live="polite" role="status" className="min-h-5 text-xs text-muted-foreground">
        {status}
      </p>
    </div>
  );
}
