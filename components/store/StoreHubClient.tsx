"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CheckCircle2, Copy, EyeOff, ExternalLink, QrCode, Share2 } from "lucide-react";
import { toast } from "sonner";

import { SaveQrButton } from "@/components/storefront/SaveQrButton";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";

/**
 * "Your store" (/store), behind the raised Store tab: is the store open to
 * buyers, and the ways to open, share and show its link. Publishing here is the
 * same `PATCH /api/vendor { publishStorefront }` as Settings → Online store
 * (OWNER only on the server); the page re-renders so the shell sees the change.
 */
export type StoreHubClientProps = {
  storeName: string;
  /** `/s/<slug>` once published; null while hidden. */
  storePath: string | null;
  /** The public link as buyers get it (for display); null while hidden. */
  storeUrl: string | null;
  /** From `qrSvgDataUrl` / `qrPngDataUrl`; empty while hidden. */
  qrSvg: string;
  qrPng: string;
  /** File name for the saved QR, without extension. */
  qrFileName: string;
  /** Only an OWNER can publish. */
  canPublish: boolean;
};

export function StoreHubClient({
  storeName,
  storePath,
  storeUrl,
  qrSvg,
  qrPng,
  qrFileName,
  canPublish,
}: StoreHubClientProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);

  function publish() {
    if (pending) return;
    startTransition(async () => {
      try {
        const res = await fetch("/api/vendor", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ publishStorefront: true }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          toast.error(body.error ?? "Could not publish your store.");
          return;
        }
        toast.success("Your store is live.");
        router.refresh();
      } catch {
        toast.error("Network error. Please try again.");
      }
    });
  }

  if (!storePath || !storeUrl) {
    return (
      <section aria-labelledby="store-status-heading" className="rounded-lg border bg-card p-4">
        <h2 id="store-status-heading" className="flex items-center gap-2 font-semibold text-foreground">
          <EyeOff className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          Hidden from buyers
        </h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Your store link doesn&rsquo;t open for buyers until the store is published.
        </p>
        {canPublish ? (
          <Button type="button" className="mt-4 w-full sm:w-auto" onClick={publish} disabled={pending} aria-busy={pending}>
            Publish store
          </Button>
        ) : (
          <p className="mt-3 text-sm font-medium text-foreground">Ask the store owner to publish it.</p>
        )}
      </section>
    );
  }

  // The link as this browser reaches it (the same origin the app is on).
  const shareUrl = () => `${window.location.origin}${storePath}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl());
      setCopied(true);
      toast.success("Link copied.");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy. Press and hold the link above to copy it.");
    }
  }

  /** The phone's share sheet (WhatsApp, Instagram…), or a copied link where there is none. */
  async function shareLink() {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: storeName, text: `Order from ${storeName} online`, url: shareUrl() });
        return;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        // Share API present but refused (permission policy): copy instead.
      }
    }
    await copyLink();
  }

  return (
    <div className="space-y-3">
      <section aria-labelledby="store-status-heading" className="rounded-lg border bg-card p-4">
        <h2 id="store-status-heading" className="flex items-center gap-2 font-semibold text-foreground">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-hidden="true" />
          Open to buyers
        </h2>
        <p className="mt-1.5 break-all font-mono text-sm text-muted-foreground">{storeUrl}</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button asChild>
            <a href={storePath} target="_blank" rel="noopener noreferrer">
              <ExternalLink aria-hidden="true" />
              Open live store
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </Button>
          <Button type="button" variant="outline" onClick={() => void shareLink()}>
            <Share2 aria-hidden="true" />
            Share link
          </Button>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="outline" onClick={() => void copyLink()}>
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copied ? "Copied" : "Copy link"}
        </Button>
        <Button type="button" variant="outline" onClick={() => setQrOpen(true)}>
          <QrCode aria-hidden="true" />
          Show QR code
        </Button>
      </div>

      <ResponsiveDialog open={qrOpen} onOpenChange={setQrOpen}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Your store&rsquo;s QR code</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              Buyers scan it with their phone camera to open your store. Print it or post it.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogBody className="space-y-4 pb-6">
            {/* eslint-disable-next-line @next/next/no-img-element -- inline data URL, nothing to optimise */}
            <img
              src={qrSvg}
              alt={`QR code for ${storeUrl}`}
              width={240}
              height={240}
              className="mx-auto rounded-md bg-white p-2"
            />
            <SaveQrButton pngDataUrl={qrPng} fileName={qrFileName} />
          </ResponsiveDialogBody>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  );
}
