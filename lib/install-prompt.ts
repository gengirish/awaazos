import { isIOS } from "@/lib/push-client";

/**
 * "Install AwaazOS" — which install affordance, if any, this browser can be
 * offered. Pure and client-safe; the browser wiring is hooks/useInstallPrompt.ts.
 *
 *   prompt   Chromium (Android, desktop): the browser fired
 *            `beforeinstallprompt`, so a button can open its install dialog.
 *   ios      iPhone / iPad: no install API. The only way is Share → Add to
 *            Home Screen, so the affordance is an instruction, not a button.
 *   in-app   An in-app browser (Instagram, Facebook, WhatsApp…). It cannot
 *            install anything; the vendor has to open the page in a real
 *            browser first. Never shown as a button.
 *   none     Already installed (running standalone), or a browser that offers
 *            no install path (desktop Firefox / Safari): show nothing.
 */
export type InstallMode = "prompt" | "ios" | "in-app" | "none";

export type InstallEnv = {
  userAgent: string;
  /** navigator.maxTouchPoints — iPadOS Safari reports a Mac user agent. */
  maxTouchPoints: number;
  /** navigator.standalone (iOS) or display-mode: standalone. */
  standalone: boolean;
  /** A `beforeinstallprompt` event has been captured and not used yet. */
  canPrompt: boolean;
};

/** Per-device: the home-screen install banner was dismissed. */
export const INSTALL_DISMISS_KEY = "awz_install_hint_dismissed_v1";

export const INSTALL_COPY = {
  title: "Install AwaazOS",
  prompt: "Opens from your Home Screen like any app, with order alerts.",
  action: "Install app",
  /** Same steps as the phone-alerts hint in components/push/PushAlertsButton.tsx. */
  ios: "On iPhone: tap Share → Add to Home Screen, then open AwaazOS from your Home Screen. Order alerts only work from there.",
  iosShort: "Tap Share → Add to Home Screen",
  inApp: "Open this page in Chrome or Safari to install the app.",
  dismiss: "Dismiss install tip",
} as const;

/**
 * Apps that open links in their own embedded browser. Android WebViews carry
 * `; wv)`; the rest name themselves. Kept to the ones a vendor is likely to
 * arrive from (an Instagram bio link, a WhatsApp or Facebook message).
 */
const IN_APP_TOKENS = /Instagram|FBAN|FBAV|FB_IAB|FBIOS|Messenger|WhatsApp|Line\/|Snapchat|Twitter|LinkedInApp|GSA\/|; wv\)/i;

export function isInAppBrowser(userAgent: string, maxTouchPoints = 0): boolean {
  if (IN_APP_TOKENS.test(userAgent)) return true;
  // Every real iOS browser (Safari, Chrome, Firefox, Edge) ends its user agent
  // with "Safari/…"; a bare WKWebView inside another app does not. iPadOS in
  // desktop mode has no such tell, and is always a real browser.
  if (/iPhone|iPad|iPod/i.test(userAgent) && isIOS(userAgent, maxTouchPoints)) {
    return !/Safari\//i.test(userAgent);
  }
  return false;
}

export function detectInstallMode(env: InstallEnv): InstallMode {
  if (env.standalone) return "none";
  if (isInAppBrowser(env.userAgent, env.maxTouchPoints)) return "in-app";
  if (env.canPrompt) return "prompt";
  if (isIOS(env.userAgent, env.maxTouchPoints)) return "ios";
  return "none";
}
