/**
 * "Install app" on the landing page: which steps to show when the browser has
 * no native install prompt to offer. Pure and client-safe (no `window`), unit
 * tested in node (lib/__tests__/install-app.test.ts).
 *
 * Chromium fires `beforeinstallprompt` and the button uses that when it has
 * it. Everything else — iPhone, Firefox, a prompt that fired before the page
 * hydrated, Instagram's in-app browser — gets written steps instead.
 */
import { isIOS } from "@/lib/push-client";

export type InstallGuide = "in-app-browser" | "ios" | "android" | "desktop";

/** Chromium's install event; not in lib.dom.d.ts. */
export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/** Instagram / Facebook webviews can't add a site to the Home Screen. */
export function isInAppBrowser(userAgent: string): boolean {
  return /Instagram|FBAN|FBAV|FB_IAB/i.test(userAgent);
}

export function detectInstallGuide(userAgent: string, maxTouchPoints: number): InstallGuide {
  // First: most of our vendors arrive from an Instagram link, on either OS.
  if (isInAppBrowser(userAgent)) return "in-app-browser";
  if (isIOS(userAgent, maxTouchPoints)) return "ios";
  if (/Android/i.test(userAgent)) return "android";
  return "desktop";
}

export const INSTALL_STEPS: Record<InstallGuide, { intro: string; steps: string[] }> = {
  "in-app-browser": {
    intro: "Instagram's browser can't install apps. Open this page in your phone's browser first.",
    steps: [
      "Tap the ⋯ menu at the top right.",
      "Choose Open in browser (Chrome or Safari).",
      "Tap Install app again there.",
    ],
  },
  ios: {
    intro: "On iPhone and iPad the app is added from the Share menu.",
    steps: [
      "Tap the Share button.",
      "Scroll down and tap Add to Home Screen.",
      "Tap Add. AwaazOS now opens from your Home Screen.",
    ],
  },
  android: {
    intro: "Add AwaazOS from your browser's menu.",
    steps: [
      "Tap the ⋮ menu at the top right.",
      "Tap Install app or Add to Home screen.",
      "Tap Install. AwaazOS now opens from your Home screen.",
    ],
  },
  desktop: {
    intro: "Install AwaazOS from your browser. Chrome and Edge support this.",
    steps: [
      "Look for the install icon at the right of the address bar.",
      "Or open the browser menu and choose Install AwaazOS.",
      "Using a phone? Open this page there and tap Install app.",
    ],
  },
};
