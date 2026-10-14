"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { copyText } from "@/lib/clipboard";

/**
 * "Copy link" for the vendor's own store link (`/s/<slug>`), beside
 * `ShareStoreButton` on the setup checklist. Copies the canonical URL, never
 * the current location. The label goes back to "Copy link" when the button
 * loses focus — no timer.
 */
export function CopyStoreLinkButton({ slug }: { slug: string }) {
  const [status, setStatus] = useState<"" | "copied" | "failed">("");

  async function copy() {
    const ok = await copyText(`${window.location.origin}/s/${encodeURIComponent(slug)}`);
    setStatus(ok ? "copied" : "failed");
  }

  return (
    <>
      <button
        type="button"
        onClick={copy}
        onBlur={() => setStatus("")}
        className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-border/70 bg-background/90 px-3.5 text-xs font-semibold text-foreground shadow-xs transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      >
        {status === "copied" ? (
          <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        ) : (
          <Copy className="h-4 w-4 shrink-0" aria-hidden="true" />
        )}
        {status === "copied" ? "Link copied" : status === "failed" ? "Couldn't copy" : "Copy link"}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {status === "copied" ? "Store link copied" : status === "failed" ? "Couldn't copy the link" : ""}
      </span>
    </>
  );
}
