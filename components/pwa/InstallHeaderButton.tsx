"use client";

import { Download } from "lucide-react";

import { promptInstall, useInstallPrompt } from "@/hooks/useInstallPrompt";
import { openInstallGuide } from "@/lib/install-guide";
import { INSTALL_COPY } from "@/lib/install-prompt";
import { cn } from "@/lib/utils";

/**
 * Landing-page header, beside Sign in. Android / desktop Chromium open the
 * browser's install dialog; iPhone and iPad open the step-by-step dialog.
 * Anywhere else (installed, in-app on Android, Firefox) it draws nothing. Below
 * lg it is the icon alone (named for screen readers), so the row fits from 360 px.
 */
export function InstallHeaderButton({ className }: { className?: string }) {
  const { mode, guide, installing } = useInstallPrompt();
  if (mode !== "prompt" && !guide) return null;
  return (
    <button
      type="button"
      data-testid="header-install"
      disabled={installing}
      onClick={() => void (mode === "prompt" ? promptInstall() : openInstallGuide())}
      className={cn(
        "inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-md text-sm font-medium text-awaaz-charcoal outline-hidden hover:bg-muted focus-visible:ring-2 focus-visible:ring-awaaz-orange focus-visible:ring-offset-2 disabled:opacity-60 lg:px-3",
        className,
      )}
    >
      <Download className="h-4 w-4 shrink-0" aria-hidden />
      <span className="sr-only lg:not-sr-only">{INSTALL_COPY.action}</span>
    </button>
  );
}
