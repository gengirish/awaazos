"use client";

import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import {
  detectInstallGuide,
  INSTALL_STEPS,
  type BeforeInstallPromptEvent,
  type InstallGuide,
} from "@/lib/install-app";
import { isStandalone } from "@/lib/push-client";

/**
 * Landing-page "Install app". Uses the browser's own install prompt when
 * Chromium offers one (`beforeinstallprompt`); otherwise opens written steps
 * for this device. Hidden once the site is running as an installed app.
 */
export function InstallAppButton() {
  const promptRef = useRef<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [guide, setGuide] = useState<InstallGuide | null>(null);

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
  }

  if (installed) return null;

  const content = guide ? INSTALL_STEPS[guide] : null;

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
      <ResponsiveDialog open={guide !== null} onOpenChange={(open) => !open && setGuide(null)}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Install AwaazOS</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>{content?.intro}</ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogBody>
            <ol className="list-decimal space-y-2 pl-5 text-sm text-awaaz-charcoal">
              {content?.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </ResponsiveDialogBody>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}
