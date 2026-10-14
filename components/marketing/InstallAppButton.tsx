"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Download } from "lucide-react";
import { detectInstallGuide, type BeforeInstallPromptEvent, type InstallGuide } from "@/lib/install-app";
import { isStandalone } from "@/lib/push-client";

// The written steps (and the dialog primitives) load on the first tap.
const InstallGuideDialog = dynamic(() => import("@/components/marketing/InstallGuideDialog"), { ssr: false });

/**
 * Landing-page "Install app", a quiet text link under the hero's one primary
 * button. Uses the browser's own install prompt when
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
      <button
        type="button"
        onClick={onClick}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-md text-sm font-medium text-awaaz-charcoal/80 underline-offset-4 outline-hidden hover:text-awaaz-orange hover:underline focus-visible:ring-2 focus-visible:ring-awaaz-orange focus-visible:ring-offset-2"
      >
        <Download className="h-4 w-4" aria-hidden="true" />
        Install app
      </button>
      {guide ? <InstallGuideDialog guide={guide} open={open} onOpenChange={setOpen} /> : null}
    </>
  );
}
