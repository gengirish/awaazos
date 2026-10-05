"use client";

import { Check, Copy, MessageCircle, Share2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { buildDropShareText, buildWhatsAppShareUrl } from "@/lib/drops-share";
import { cn } from "@/lib/utils";

export type ShareDropButtonProps = {
  vendorName: string;
  vendorSlug: string;
  dropTitle: string;
  closesAt: string; // ISO
  fulfilmentStartsAt: string; // ISO
  fulfilmentEndsAt: string; // ISO
  fulfilmentMode: "DELIVERY" | "PICKUP" | "BOTH";
  itemNames: string[];
};

const baseBtn =
  "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-60";

/**
 * Vendor-side "share today's menu" control. The native share sheet is the
 * primary path on Android/iOS; desktop browsers without it fall back to a
 * wa.me link. Every navigator call is best-effort: a dismissed share sheet
 * (AbortError) or a blocked clipboard is not an error the vendor needs to see.
 */
export function ShareDropButton(props: ShareDropButtonProps) {
  const {
    vendorName,
    vendorSlug,
    dropTitle,
    closesAt,
    fulfilmentStartsAt,
    fulfilmentEndsAt,
    fulfilmentMode,
    itemNames,
  } = props;

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

  const text = useMemo(
    () =>
      buildDropShareText({
        vendorName,
        dropTitle,
        closesAt: new Date(closesAt),
        fulfilmentStartsAt: new Date(fulfilmentStartsAt),
        fulfilmentEndsAt: new Date(fulfilmentEndsAt),
        fulfilmentMode,
        itemNames,
        url,
      }),
    [vendorName, dropTitle, closesAt, fulfilmentStartsAt, fulfilmentEndsAt, fulfilmentMode, itemNames, url],
  );

  function openWhatsApp() {
    window.open(buildWhatsAppShareUrl(text), "_blank", "noopener,noreferrer");
  }

  async function share() {
    setStatus("");
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        // `text` already ends with the link; passing `url` too lets apps that
        // ignore text (some mail clients) still get it.
        await navigator.share({ title: `${dropTitle} by ${vendorName}`, text, url });
        return;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return; // vendor dismissed the sheet
        // Share API present but failed (e.g. permission policy) — fall through to WhatsApp.
      }
    }
    openWhatsApp();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setStatus("Message copied");
    } catch {
      setStatus("Couldn't copy — use the WhatsApp button instead");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={share} className={cn(baseBtn, "bg-primary text-primary-foreground hover:bg-primary/90")}>
        <Share2 className="h-4 w-4" aria-hidden="true" />
        Share today&apos;s menu
      </button>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={copy}
          className={cn(baseBtn, "flex-1 border border-border bg-background text-foreground hover:bg-muted")}
        >
          {copied ? (
            <Check className="h-4 w-4 text-primary" aria-hidden="true" />
          ) : (
            <Copy className="h-4 w-4" aria-hidden="true" />
          )}
          {copied ? "Copied" : "Copy message"}
        </button>
        <button
          type="button"
          onClick={openWhatsApp}
          className={cn(baseBtn, "flex-1 border border-border bg-background text-foreground hover:bg-muted")}
        >
          <MessageCircle className="h-4 w-4" aria-hidden="true" />
          WhatsApp
        </button>
      </div>
      <p aria-live="polite" role="status" className="min-h-5 text-xs text-muted-foreground">
        {status}
      </p>
    </div>
  );
}
