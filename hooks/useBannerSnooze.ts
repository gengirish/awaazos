"use client";

import { useCallback, useSyncExternalStore } from "react";

import { BANNER_SNOOZE_DAYS, isBannerSnoozed } from "@/lib/orders-banner";

const listeners = new Set<() => void>();
/** Without storage a "Not now" still holds until the page is left. */
const snoozedThisPage = new Set<string>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readSnoozed(key: string, days: number): boolean {
  if (snoozedThisPage.has(key)) return true;
  try {
    return isBannerSnoozed(window.localStorage.getItem(key), Date.now(), days);
  } catch {
    return false;
  }
}

/**
 * A per-device "Not now" for a dismissible prompt, lasting `days`
 * (`DISMISS_FOR_GOOD` for a one-time prompt). Reads as snoozed on the server
 * and on the first client render, so a prompt is only drawn after mount.
 */
export function useBannerSnooze(
  key: string,
  days: number = BANNER_SNOOZE_DAYS,
): { snoozed: boolean; snooze: () => void } {
  const snoozed = useSyncExternalStore(
    subscribe,
    () => readSnoozed(key, days),
    () => true,
  );
  const snooze = useCallback(() => {
    snoozedThisPage.add(key);
    try {
      window.localStorage.setItem(key, String(Date.now()));
    } catch {
      // No storage: it comes back on the next visit, which is harmless.
    }
    listeners.forEach((listener) => listener());
  }, [key]);
  return { snoozed, snooze };
}
