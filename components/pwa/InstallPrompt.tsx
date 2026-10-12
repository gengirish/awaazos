"use client";

import { Download, Share, X } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import {
  dismissInstallHint,
  promptInstall,
  setInstallBannerPresence,
  useInstallPrompt,
} from "@/hooks/useInstallPrompt";
import { INSTALL_COPY } from "@/lib/install-prompt";
import { cn } from "@/lib/utils";

/**
 * "Install AwaazOS" affordances. All three read one shared state
 * (hooks/useInstallPrompt.ts) and draw nothing on the server or before mount.
 *
 *   InstallBanner      one dismissible in-flow banner on the home screens
 *                      (/orders, /pos), until dismissed or installed.
 *   InstallSheetRow    a row in the shell's "More" sheet on phones. Stays after
 *                      the banner is dismissed: it is how to find install again.
 *   InstallRailButton  the rail foot from md, only where the browser can prompt.
 *
 * Android / desktop Chromium get a button that opens the browser's install
 * dialog. iPhone has no install API, so it gets the Share → Add to Home Screen
 * steps as text. In-app browsers (Instagram, Facebook…) can't install at all:
 * no banner, and the sheet row says to open the page in a real browser.
 */

const ICON_BADGE = "flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-foreground";

export function InstallBanner({ className }: { className?: string }) {
  const { mode, dismissed, installing } = useInstallPrompt();
  const visible = (mode === "prompt" || mode === "ios") && !dismissed;

  useEffect(() => {
    if (!visible) return;
    setInstallBannerPresence(true);
    return () => setInstallBannerPresence(false);
  }, [visible]);

  if (!visible) return null;

  return (
    <section
      aria-label={INSTALL_COPY.title}
      data-testid="install-banner"
      className={cn("flex items-center gap-2 rounded-md border bg-muted/50 py-1 pl-3 pr-1 text-sm print:hidden", className)}
    >
      {mode === "ios" ? <Share className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden /> : null}
      <div className="min-w-0 flex-1 py-2">
        <p className="font-semibold text-foreground">{INSTALL_COPY.title}</p>
        <p className={cn("text-muted-foreground", mode === "prompt" && "hidden sm:block")}>
          {mode === "ios" ? INSTALL_COPY.ios : INSTALL_COPY.prompt}
        </p>
      </div>
      {mode === "prompt" ? (
        <Button
          type="button"
          className="min-h-11 shrink-0"
          onClick={() => void promptInstall()}
          disabled={installing}
        >
          <Download aria-hidden />
          {INSTALL_COPY.action}
        </Button>
      ) : null}
      <button
        type="button"
        onClick={dismissInstallHint}
        aria-label={INSTALL_COPY.dismiss}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center self-start rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </section>
  );
}

/** `<li>` for the shell's "More" sheet; renders nothing when there is nothing to offer. */
export function InstallSheetRow({ rowClassName, onPrompt }: { rowClassName: string; onPrompt?: () => void }) {
  const { mode, installing } = useInstallPrompt();

  if (mode === "prompt") {
    return (
      <li>
        <button
          type="button"
          className={rowClassName}
          disabled={installing}
          onClick={() => {
            onPrompt?.();
            void promptInstall();
          }}
        >
          <span className={ICON_BADGE}>
            <Download className="h-5 w-5" aria-hidden />
          </span>
          <span className="min-w-0 flex-1 font-semibold text-foreground">{INSTALL_COPY.action}</span>
        </button>
      </li>
    );
  }

  if (mode === "ios" || mode === "in-app") {
    // Instructions, not a control: there is nothing here a tap could do.
    return (
      <li className="flex min-h-14 items-center gap-3 px-4 py-3">
        <span className={ICON_BADGE}>
          {mode === "ios" ? <Share className="h-5 w-5" aria-hidden /> : <Download className="h-5 w-5" aria-hidden />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-foreground">{INSTALL_COPY.action}</span>
          <span className="block text-sm text-muted-foreground">
            {mode === "ios" ? INSTALL_COPY.iosShort : INSTALL_COPY.inApp}
          </span>
        </span>
      </li>
    );
  }

  return null;
}

/** Rail foot (md+). Only where the browser handed us an install prompt. */
export function InstallRailButton({ className }: { className: string }) {
  const { mode, installing } = useInstallPrompt();
  if (mode !== "prompt") return null;
  return (
    <button type="button" className={className} disabled={installing} onClick={() => void promptInstall()}>
      <Download className="h-5 w-5 shrink-0" aria-hidden />
      <span className="max-w-full truncate">
        Install<span className="sr-only"> app</span>
      </span>
    </button>
  );
}
