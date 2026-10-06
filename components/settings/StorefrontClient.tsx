"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";

/**
 * Owner-facing control for the public storefront at /s/<slug>.
 *
 * Publishing is a one-way door in the vendor's eyes — menu names and prices
 * become world-readable — so the switch states its consequence in plain words
 * rather than a bare "Enabled" label.
 */
export type StorefrontClientProps = {
  slug: string;
  initialPublished: boolean;
  hasUpiId: boolean;
  availableItemCount: number;
};

export function StorefrontClient({
  slug,
  initialPublished,
  hasUpiId,
  availableItemCount,
}: StorefrontClientProps) {
  const [published, setPublished] = useState(initialPublished);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const path = `/s/${slug}`;

  function toggle(next: boolean) {
    if (pending) return;
    startTransition(async () => {
      try {
        const res = await fetch("/api/vendor", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ publishStorefront: next }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          toast.error(body.error ?? "Could not update your storefront.");
          return;
        }
        setPublished(next);
        toast.success(next ? "Storefront is live." : "Storefront is now private.");
      } catch {
        toast.error("Network error — please try again.");
      }
    });
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${path}`);
      setCopied(true);
      toast.success("Link copied.");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy — long-press the link to copy it manually.");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <label htmlFor="storefront-toggle" className="text-sm font-medium">
            Publish my menu
          </label>
          <p className="text-xs text-muted-foreground">
            {published
              ? "Anyone with the link can see your item names and prices."
              : "Your menu is private. Nobody outside your staff can see it."}
          </p>
        </div>
        <button
          id="storefront-toggle"
          type="button"
          role="switch"
          aria-checked={published}
          onClick={() => toggle(!published)}
          disabled={pending}
          className="inline-flex min-h-11 min-w-14 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="sr-only">
            {published ? "Unpublish storefront" : "Publish storefront"}
          </span>
          {/* 44px tap target around the 28px visual track. */}
          <span
            aria-hidden="true"
            className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
              published ? "bg-primary" : "bg-input"
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-background shadow transition-transform motion-reduce:transition-none ${
                published ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </span>
        </button>
      </div>

      {published ? (
        <div className="space-y-3 rounded-lg border border-border/60 bg-muted/30 p-3">
          <p className="break-all font-mono text-xs text-muted-foreground">{path}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={copyLink}
              className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {copied ? (
                <Check className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Copy className="h-4 w-4" aria-hidden="true" />
              )}
              {copied ? "Copied" : "Copy link"}
            </button>
            <a
              href={path}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              Preview
            </a>
          </div>
        </div>
      ) : null}

      {published && availableItemCount === 0 ? (
        <p className="text-xs text-amber-600">
          Your storefront is live but has no available items — add menu items so customers see
          something.
        </p>
      ) : null}

      {published && !hasUpiId ? (
        <p className="text-xs text-amber-600">
          No UPI ID saved, so the page shows the menu without a payment QR.{" "}
          <Link href="/settings/payments" className="font-medium underline underline-offset-4">
            Add your UPI ID in Payments
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}
