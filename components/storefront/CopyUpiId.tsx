"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * The UPI handle is the one string a customer may need to type by hand when the
 * QR won't scan, so it gets a real 44px tap target rather than being decorative
 * text. Clipboard writes are best-effort — an insecure context or a denied
 * permission silently leaves the id selectable, which is the fallback anyway.
 * A successful copy shows a "Copied" pill for ~2 s and is announced through a
 * polite live region (color is never the only signal).
 */
export function CopyUpiId({ upiId, className }: { upiId: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(upiId);
      setCopied(true);
    } catch {
      /* clipboard unavailable — the id is still on screen to read */
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? `UPI ID ${upiId} copied` : `Copy UPI ID ${upiId}`}
        className={cn(
          "inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border px-4 py-2 font-mono text-sm transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 motion-reduce:transition-none",
          copied
            ? "border-primary bg-primary/10 text-foreground"
            : "border-border/70 bg-background text-foreground hover:border-primary/50 hover:bg-primary/5",
          className,
        )}
      >
        <span className="truncate">{upiId}</span>
        {copied ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-foreground px-2 py-0.5 font-sans text-xs font-bold text-background">
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            Copied
          </span>
        ) : (
          <Copy className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
      </button>
      {/* Always mounted so screen readers pick up the change. */}
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? "UPI ID copied" : ""}
      </span>
    </>
  );
}
