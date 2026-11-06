"use client";

import { Download, Share, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { promptInstall, useInstallPrompt } from "@/hooks/useInstallPrompt";
import { openInstallGuide } from "@/lib/install-guide";
import { isIOS } from "@/lib/push-client";
import {
  openInChromeIntentUrl,
  STORE_INSTALL_COPY as COPY,
  storeInstallDismissKey,
  storeManifestPath,
} from "@/lib/store-app";
import { cn } from "@/lib/utils";

/**
 * "Add <store> to your Home Screen" for buyers: installs the store's own app
 * (lib/store-app.ts), linked by the app/s/[slug] layout. A view over the one
 * install store (hooks/useInstallPrompt.ts), never a second detector; only the
 * close is its own, per store and device, so closing it on one store leaves
 * the seller app's banner and other stores alone.
 *
 *   prompt   Android / desktop Chrome: one button opens the browser's dialog.
 *   ios      iPhone / iPad Safari: the Share steps, plus the picture guide.
 *   in-app   Instagram, WhatsApp, Facebook… can't install. Android gets
 *            "Open in Chrome" (an intent link); iPhone the guide, which walks
 *            the buyer out to Safari.
 *   none     Installed, or a browser with no install path: nothing.
 *
 * Draws nothing on the server or before mount. No timers: browser events only.
 */
export function StoreInstall({ slug, storeName, className }: { slug: string; storeName: string; className?: string }) {
  const { mode, guide, installing } = useInstallPrompt();
  // null until mount: the close is read from this device's storage.
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  const [android, setAndroid] = useState(false);

  useEffect(() => {
    let closed = false;
    try {
      closed = window.localStorage.getItem(storeInstallDismissKey(slug)) === "1";
    } catch {
      // Blocked storage: show it; closing then lasts for this page only.
    }
    setDismissed(closed);
    setAndroid(/Android/i.test(navigator.userAgent) && !isIOS(navigator.userAgent, navigator.maxTouchPoints ?? 0));
  }, [slug]);

  if (dismissed !== false || mode === "loading" || mode === "none") return null;
  // An Android in-app browser with no way out to Chrome, or a desktop one: nothing to offer.
  if (mode === "in-app" && !guide && !android) return null;

  const close = () => {
    try {
      window.localStorage.setItem(storeInstallDismissKey(slug), "1");
    } catch {
      // Private mode: it comes back on the next visit.
    }
    setDismissed(true);
  };

  const showGuide = () =>
    void openInstallGuide({ manifestUrl: storeManifestPath(slug), description: COPY.body });

  const openInChrome = () => {
    const intent = openInChromeIntentUrl(window.location.href);
    if (intent) window.location.href = intent;
  };

  const title = COPY.title(storeName);

  return (
    <section
      aria-label={title}
      data-testid="store-install"
      className={cn(
        "flex items-start gap-3 rounded-2xl border border-primary/25 bg-background p-3 pr-1 text-sm shadow-xs print:hidden",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
      >
        {mode === "ios" ? <Share className="h-5 w-5" /> : <Download className="h-5 w-5" />}
      </span>
      <div className="min-w-0 flex-1 py-0.5">
        <p className="font-semibold text-foreground">{title}</p>
        <p className="mt-0.5 text-muted-foreground">
          {mode === "ios" ? COPY.ios : mode === "in-app" ? COPY.inApp : COPY.body}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {mode === "prompt" ? (
            <Button type="button" className="min-h-11" disabled={installing} onClick={() => void promptInstall()}>
              <Download aria-hidden />
              {COPY.action}
            </Button>
          ) : null}
          {mode === "in-app" && android ? (
            <Button type="button" className="min-h-11" onClick={openInChrome}>
              {COPY.openInChrome}
            </Button>
          ) : null}
          {guide ? (
            <Button type="button" variant="outline" className="min-h-11" onClick={showGuide}>
              {COPY.guide}
            </Button>
          ) : null}
        </div>
      </div>
      <button
        type="button"
        onClick={close}
        aria-label={COPY.dismiss}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </section>
  );
}
