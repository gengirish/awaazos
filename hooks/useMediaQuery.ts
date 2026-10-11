"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Tailwind's `md` breakpoint: the width where bottom sheets become centred dialogs. */
export const DESKTOP_QUERY = "(min-width: 768px)";

/**
 * Whether a CSS media query matches. The server and the hydration pass always
 * see `false`; the real value arrives in the re-render straight after, so
 * there is no hydration mismatch.
 *
 * Use it for behaviour only (e.g. auto-print on a counter computer). Layout
 * belongs in CSS breakpoints: switching component trees on this value would
 * remount whatever is inside them and drop its state.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export function useIsDesktop(): boolean {
  return useMediaQuery(DESKTOP_QUERY);
}
