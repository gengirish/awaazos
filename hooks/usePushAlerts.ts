"use client";

import { useSyncExternalStore } from "react";

import {
  getPermission,
  getPushSupport,
  getThisDeviceSubscription,
  subscribeThisDevice,
  unsubscribeThisDevice,
} from "@/lib/push-client";

/**
 * This device's phone-alert state, shared by every piece of UI that shows it.
 *
 * An orders board draws the opt-in up to three times (the header from md, the
 * "More actions" sheet and the prompt row on phones) and Settings →
 * Notifications draws it once more. They all read this one store, so:
 *   - the browser is asked about its subscription once per page, not once per
 *     copy (that check registers /sw.js and reads the PushManager);
 *   - subscribing from one copy updates the others at once;
 *   - there is one in-flight action at a time (`busy`), whichever copy started it.
 *
 * Detection runs when the first copy mounts and again whenever the UI comes
 * back after being fully unmounted (a new page), never on a timer. The server
 * render and the first client render both see `loading`.
 */

export type PushView =
  | "loading"
  | "not-configured"
  | "unsupported"
  | "ios-needs-install"
  | "default"
  | "denied"
  | "subscribed";

export type PushBusy = "subscribe" | "unsubscribe" | "test" | null;

export type PushAlertsState = {
  view: PushView;
  busy: PushBusy;
  /** Visible + announced feedback for the last action. */
  message: string;
  tooMany: boolean;
  /** The phone-alerts tip / prompt was dismissed on this device. */
  dismissed: boolean;
};

/** Per-device: "don't nudge me about phone alerts here". */
export const PUSH_DISMISS_KEY = "awz_push_hint_dismissed_v1";

export const PUSH_COPY = {
  notConfigured: "Phone alerts aren't set up on this server yet.",
  unsupported: "This browser can't show alerts. Try Chrome on Android.",
  iosInstall:
    "On iPhone: tap Share → Add to Home Screen, then open AwaazOS from your Home Screen and turn on alerts here.",
  denied: "Alerts are blocked for this site. Allow notifications in your browser settings, then try again.",
  subscribed: "Alerts on for this phone",
  dismissedPrompt: "Alerts not turned on. Tap the button again and choose Allow.",
  failed: "Couldn't turn on alerts. Check your internet and try again.",
  tooManyDevices: "You have alerts on 10 devices already. Remove an old one in Settings → Notifications.",
  turnedOn: "Alerts turned on. New orders will show on this phone even when the screen is locked.",
  turnedOff: "Alerts turned off for this phone.",
  testSent: "Sent — check your notifications",
  testFailed: "Couldn't send a test alert. Try again.",
} as const;

const INITIAL: PushAlertsState = { view: "loading", busy: null, message: "", tooMany: false, dismissed: false };

let state: PushAlertsState = INITIAL;
let detectSeq = 0;
const listeners = new Set<() => void>();

function set(patch: Partial<PushAlertsState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(PUSH_DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

async function detectView(): Promise<PushView> {
  const support = getPushSupport();
  if (support !== "supported") return support;
  const permission = getPermission();
  if (permission === "denied") return "denied";
  if (permission !== "granted") return "default";
  const sub = await getThisDeviceSubscription();
  return sub ? "subscribed" : "default";
}

/** Ask the browser again (e.g. after the vendor changed a site permission). */
export function recheckPushAlerts(): void {
  const seq = ++detectSeq;
  void detectView().then((view) => {
    // A newer check, or an action that sets the view itself, wins.
    if (seq === detectSeq && state.busy === null) set({ view });
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    // First copy on this page: drop the last page's feedback and look again.
    set({ dismissed: readDismissed(), message: "", tooMany: false });
    recheckPushAlerts();
  }
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = (): PushAlertsState => state;
const getServerSnapshot = (): PushAlertsState => INITIAL;

export function usePushAlerts(): PushAlertsState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Asks for notification permission: call only from a tap. Resolves true once subscribed. */
export async function turnOnPushAlerts(): Promise<boolean> {
  if (state.busy !== null) return false;
  set({ busy: "subscribe", message: "", tooMany: false });
  try {
    const res = await subscribeThisDevice();
    if (res.ok) {
      set({ view: "subscribed", message: PUSH_COPY.turnedOn });
      return true;
    }
    if (res.reason === "denied") {
      // "default" means the prompt was closed without choosing.
      if (getPermission() === "denied") set({ view: "denied", message: PUSH_COPY.denied });
      else set({ message: PUSH_COPY.dismissedPrompt });
    } else if (res.reason === "too_many_devices") {
      set({ tooMany: true, message: PUSH_COPY.tooManyDevices });
    } else if (res.reason === "unsupported" || res.reason === "not-configured") {
      set({ view: res.reason });
    } else {
      set({ message: PUSH_COPY.failed });
    }
    return false;
  } finally {
    set({ busy: null });
  }
}

export async function turnOffPushAlerts(): Promise<void> {
  if (state.busy !== null) return;
  set({ busy: "unsubscribe", message: "" });
  try {
    await unsubscribeThisDevice();
    detectSeq++; // A check started before this is out of date now.
    set({ view: await detectView(), message: PUSH_COPY.turnedOff });
  } finally {
    set({ busy: null });
  }
}

export async function sendTestPushAlert(): Promise<void> {
  if (state.busy !== null) return;
  set({ busy: "test", message: "" });
  try {
    const res = await fetch("/api/push/test", { method: "POST" });
    set({ message: res.ok ? PUSH_COPY.testSent : PUSH_COPY.testFailed });
  } catch {
    set({ message: PUSH_COPY.testFailed });
  } finally {
    set({ busy: null });
  }
}

/** Hide the phone-alerts tip and prompt on this device. The opt-in stays in the sheet and in Settings. */
export function dismissPushHint(): void {
  try {
    window.localStorage.setItem(PUSH_DISMISS_KEY, "1");
  } catch {
    // Private mode / blocked storage: the hint just comes back next visit.
  }
  set({ dismissed: true });
}
