"use client";

import { useSyncExternalStore } from "react";

import { detectInstallMode, INSTALL_DISMISS_KEY, type InstallMode } from "@/lib/install-prompt";

/**
 * One shared install state for the whole page: the shell's "Install app" row,
 * the rail button and the home-screen banner all read it, so there is a single
 * captured `beforeinstallprompt` event and a single dismissal.
 *
 * No timers, no polling, no network: everything here is driven by browser
 * events (`beforeinstallprompt`, `appinstalled`, a display-mode change).
 * The server render and the first client render both see `loading`, so nothing
 * is drawn until after mount and there is no hydration mismatch.
 */

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<unknown>;
  userChoice?: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export type InstallState = {
  mode: InstallMode | "loading";
  /** The home-screen banner was dismissed on this device. */
  dismissed: boolean;
  /** The browser's install dialog is open. */
  installing: boolean;
  /** A home-screen banner is on screen right now (see `setInstallBannerPresence`). */
  bannerShowing: boolean;
};

const INITIAL: InstallState = { mode: "loading", dismissed: false, installing: false, bannerShowing: false };

let state: InstallState = INITIAL;
let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
let started = false;
let banners = 0;
const listeners = new Set<() => void>();

function set(patch: Partial<InstallState>): void {
  const next = { ...state, ...patch };
  if (
    next.mode === state.mode &&
    next.dismissed === state.dismissed &&
    next.installing === state.installing &&
    next.bannerShowing === state.bannerShowing
  ) {
    return;
  }
  state = next;
  listeners.forEach((l) => l());
}

function isStandalone(): boolean {
  if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
  try {
    return window.matchMedia?.("(display-mode: standalone)").matches ?? false;
  } catch {
    return false;
  }
}

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(INSTALL_DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function currentMode(): InstallMode {
  if (installed) return "none";
  return detectInstallMode({
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    standalone: isStandalone(),
    canPrompt: deferred !== null,
  });
}

function onBeforeInstallPrompt(event: Event): void {
  // Keep Chrome's own mini-infobar away: ours is the one affordance.
  event.preventDefault();
  deferred = event as BeforeInstallPromptEvent;
  if (started) set({ mode: currentMode() });
}

function onInstalled(): void {
  installed = true;
  deferred = null;
  if (started) set({ mode: "none", installing: false });
}

// Chrome can fire `beforeinstallprompt` before React has hydrated, and it is
// not re-fired for a listener that arrives late. Listen as soon as this module
// loads in a browser; components pick the event up when they subscribe.
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  window.addEventListener("appinstalled", onInstalled);
}

function start(): void {
  if (started) return;
  started = true;
  try {
    // Installed while the tab was open (or opened in the app window).
    window.matchMedia?.("(display-mode: standalone)").addEventListener?.("change", () => {
      set({ mode: currentMode() });
    });
  } catch {
    // Old browser: the mode is still right on the next page load.
  }
  set({ mode: currentMode(), dismissed: readDismissed() });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  start();
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = (): InstallState => state;
const getServerSnapshot = (): InstallState => INITIAL;

export function useInstallPrompt(): InstallState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Open the browser's install dialog. Call only from a tap: the event is
 * single-use, so the affordance goes away until the browser offers again.
 */
export async function promptInstall(): Promise<void> {
  const event = deferred;
  if (!event) return;
  deferred = null;
  set({ installing: true });
  try {
    await event.prompt();
    const choice = await event.userChoice;
    if (choice?.outcome === "accepted") installed = true;
  } catch {
    // The browser refused (already shown, or no longer installable).
  } finally {
    set({ installing: false, mode: currentMode() });
  }
}

/** Hide the home-screen banner on this device. The shell's "Install app" row stays. */
export function dismissInstallHint(): void {
  try {
    window.localStorage.setItem(INSTALL_DISMISS_KEY, "1");
  } catch {
    // Private mode / blocked storage: the banner just comes back next visit.
  }
  set({ dismissed: true });
}

/**
 * The banner reports itself while it is on screen, so the phone-alerts hint
 * (which gives iPhone users the same Add-to-Home-Screen steps) can stand down
 * and a vendor never reads the instruction twice on one screen.
 */
export function setInstallBannerPresence(showing: boolean): void {
  banners = Math.max(0, banners + (showing ? 1 : -1));
  set({ bannerShowing: banners > 0 });
}
