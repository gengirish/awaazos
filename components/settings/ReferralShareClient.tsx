"use client";

import { Check, Copy, MessageCircle } from "lucide-react";
import { useState } from "react";

import { InstagramStoryButton } from "@/components/drops/InstagramStoryButton";
import { referralWhatsappMessage, referralWhatsappUrl } from "@/lib/referral-message";
import { cn } from "@/lib/utils";

const baseBtn =
  "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-60";

/**
 * Settings → Refer a seller: the referral link with Copy, "Share on WhatsApp"
 * (wa.me with no number and a pre-filled note, lib/referral-message.ts) and
 * the Instagram story image (GET /api/vendor/referrals/story-image, through
 * InstagramStoryButton and its two-tap share). Nothing is sent from our side.
 * The copy confirmation stays until the next action: no timer.
 */
export function ReferralShareClient({ link, storeName }: { link: string; storeName: string }) {
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState("");
  const whatsappUrl = referralWhatsappUrl(referralWhatsappMessage({ storeName, link }));

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setStatus("Referral link copied");
    } catch {
      setCopied(false);
      setStatus("Couldn't copy. Press and hold the link to copy it.");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="break-all rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-sm text-foreground">
        {link}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button
          type="button"
          onClick={() => void copy()}
          className={cn(baseBtn, "border border-border bg-background text-foreground hover:bg-muted")}
        >
          {copied ? <Check className="h-4 w-4 text-primary" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
          {copied ? "Copied" : "Copy link"}
        </button>
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => setStatus("")}
          className={cn(baseBtn, "bg-primary text-primary-foreground hover:bg-primary/90")}
        >
          <MessageCircle className="h-4 w-4" aria-hidden="true" />
          Share on WhatsApp
        </a>
        <div className="flex gap-2">
          <InstagramStoryButton
            src="/api/vendor/referrals/story-image"
            fileName="refer-a-seller-story.png"
            url={link}
            className={baseBtn}
            onStatus={(message) => {
              setCopied(false);
              setStatus(message);
            }}
          />
        </div>
      </div>
      <p aria-live="polite" role="status" className="min-h-5 text-xs text-muted-foreground">
        {status}
      </p>
    </div>
  );
}
