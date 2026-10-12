"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { detectInstallGuide, type BeforeInstallPromptEvent, type InstallGuide } from "@/lib/install-app";
import { isStandalone } from "@/lib/push-client";

// The written steps (and the dialog primitives) load on the first tap.
const InstallGuideDialog = dynamic(() => import("@/components/marketing/InstallGuideDialog"), { ssr: false });

/**
 * Landing-page "Install app". Uses the browser's own install prompt when
 * Chromium offers one (`beforeinstallprompt`); otherwise opens written steps
 * for this device. Hidden once the site is running as an installed app.
 */
export function InstallAppButton() {
  const promptRef = useRef<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  // `guide` stays set after closing so the dialog can play its exit animation.
  const [guide, setGuide] = useState<InstallGuide | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (isStandalone()) setInstalled(true);

    const onBeforeInstall = (e: Event) => {
      // Stops Chrome's own mini-infobar; the prompt is shown from the button.
      e.preventDefault();
      promptRef.current = e as BeforeInstallPromptEvent;
    };
    const onInstalled = () => {
      promptRef.current = null;
      setInstalled(true);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function onClick() {
    const prompt = promptRef.current;
    if (prompt) {
      // A captured event can be prompted once only.
      promptRef.current = null;
      try {
        await prompt.prompt();
        return;
      } catch {
        // Fall through to the written steps.
      }
    }
    setGuide(detectInstallGuide(navigator.userAgent, navigator.maxTouchPoints ?? 0));
    setOpen(true);
  }

  if (installed) return null;

  return (
    <>
      <Button
        type="button"
        size="lg"
        variant="outline"
        onClick={onClick}
        className="min-h-12 min-w-[44px] border-awaaz-charcoal/25 bg-white px-6 text-base font-semibold text-awaaz-charcoal hover:bg-muted focus-visible:ring-2 focus-visible:ring-awaaz-orange focus-visible:ring-offset-2"
      >
        <Download aria-hidden="true" />
        Install app
      </Button>
      {guide ? <InstallGuideDialog guide={guide} open={open} onOpenChange={setOpen} /> : null}
    </>
  );
}
