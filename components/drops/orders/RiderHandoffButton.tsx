"use client";

import { Bike, Check, MessageCircle, Share2 } from "lucide-react";
import { useEffect, useState } from "react";

import { formatRiderHandoff, riderWhatsappUrl, type RiderHandoffOrder } from "@/lib/delivery-handoff";
import type { DeliveryRider } from "@/lib/delivery-riders";
import { cn } from "@/lib/utils";

const btn =
  "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";

/**
 * "Copy for rider": one delivery order's name, phone, address, items and what
 * to collect, for Porter / Rapido or the seller's own rider. Phones that can
 * share also get a Share button (WhatsApp the rider directly), and each saved
 * rider (Settings → Online orders) gets "Send to <name>", a wa.me link to that
 * rider with the text filled in. The text holds buyer PII, so it goes only to
 * the clipboard, the share sheet or the seller's own WhatsApp — never logged.
 */
export function RiderHandoffButton({
  order,
  vendorName,
  riders = [],
  className,
}: {
  order: RiderHandoffOrder;
  vendorName: string;
  riders?: DeliveryRider[];
  className?: string;
}) {
  const [canShare, setCanShare] = useState(false);
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState("");

  // navigator is unavailable during SSR; decide after mount.
  useEffect(() => {
    setCanShare(typeof navigator.share === "function");
  }, []);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  const text = () => formatRiderHandoff(order, vendorName);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text());
      setCopied(true);
      setStatus("Copied — paste it into Porter, Rapido or your rider's chat.");
    } catch {
      setStatus(canShare ? "Couldn't copy. Use Share instead." : "Couldn't copy on this browser.");
    }
  }

  async function share() {
    setStatus("");
    try {
      await navigator.share({ title: `Delivery ${order.billNumber}`, text: text() });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return; // seller closed the sheet
      await copy();
    }
  }

  return (
    <div className={cn("print:hidden", className)}>
      {riders.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {riders.map((rider) => (
              <a
                key={rider.phone}
                href={riderWhatsappUrl(rider, text())}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(btn, "flex-1")}
                aria-label={`Send ${order.billNumber} to ${rider.name} on WhatsApp`}
              >
                <MessageCircle className="h-4 w-4" aria-hidden />
                Send to {rider.name}
              </a>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={() => void copy()} className={cn(btn, "flex-1")}>
          {copied ? <Check className="h-4 w-4 text-primary" aria-hidden /> : <Bike className="h-4 w-4" aria-hidden />}
          {copied ? "Copied" : "Copy for rider"}
        </button>
        {canShare && (
          <button
            type="button"
            onClick={() => void share()}
            className={btn}
            aria-label={`Share delivery details for ${order.billNumber}`}
          >
            <Share2 className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
      <p role="status" aria-live="polite" className="mt-1 text-xs text-muted-foreground">
        {status}
      </p>
    </div>
  );
}
