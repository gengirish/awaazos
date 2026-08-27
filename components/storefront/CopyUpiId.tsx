"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * The UPI handle is the one string a customer may need to type by hand when the
 * QR won't scan, so it gets a real 44px tap target rather than being decorative
 * text. Clipboard writes are best-effort — an insecure context or a denied
 * permission silently leaves the id selectable, which is the fallback anyway.
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
    <button
      type="button"
      onClick={copy}
      className={cn(
        "inline-flex min-h-11 items-center gap-2 rounded-full border border-border/70 bg-background px-4 py-2 font-mono text-sm text-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
        className,
      )}
    >
      <span className="truncate">{upiId}</span>
      {copied ? (
        <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      ) : (
        <Copy className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
      <span className="sr-only">{copied ? "UPI ID copied" : `Copy UPI ID ${upiId}`}</span>
      <span aria-live="polite" className="sr-only">
        {copied ? "Copied" : ""}
      </span>
    </button>
  );
}
