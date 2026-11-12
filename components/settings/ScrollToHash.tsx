"use client";

import { useEffect } from "react";

/**
 * Scrolls to the card named in the URL's `#hash` once the page is on screen
 * (`/settings/store#tagline`, linked from the Store screen). The browser's own
 * jump runs before a streamed page has the card, so it lands at the top.
 */
export function ScrollToHash() {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) return;
    const target = document.getElementById(id);
    if (!target) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
  }, []);
  return null;
}
