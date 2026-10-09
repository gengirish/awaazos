"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

const COOKIE_PREF_KEY = "awz_cookie_pref_v1";

/**
 * While shown, the banner publishes its height as `--cookie-banner-h` on
 * <html> so bottom-anchored UI (the storefront cart bar) can sit above it
 * instead of underneath — otherwise a first-time buyer on a phone can't reach
 * Checkout until they dismiss this.
 */
const HEIGHT_VAR = "--cookie-banner-h";
type CookiePref = "accepted" | "declined";

export function CookieConsentBanner() {
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const pref = localStorage.getItem(COOKIE_PREF_KEY) as CookiePref | null;
      setShow(pref !== "accepted" && pref !== "declined");
    } catch {
      setShow(true);
    }
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!show || !el) return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty(HEIGHT_VAR, `${el.offsetHeight}px`);
    publish();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(publish);
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      root.style.removeProperty(HEIGHT_VAR);
    };
  }, [show]);

  function setPref(pref: CookiePref) {
    try {
      localStorage.setItem(COOKIE_PREF_KEY, pref);
    } catch {
      // ignore storage errors
    }
    setShow(false);
  }

  if (!show) return null;

  return (
    <div
      ref={ref}
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/98 p-4 shadow-lg backdrop-blur-sm print:hidden"
      role="dialog"
      aria-live="polite"
      aria-label="Cookie consent"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          We use essential cookies for authentication and security. Optional analytics/error monitoring cookies help us
          improve reliability. See our <Link href="/legal/privacy" className="underline">Privacy Policy</Link>.
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => setPref("declined")}>
            Decline optional
          </Button>
          <Button type="button" size="sm" className="min-h-11" onClick={() => setPref("accepted")}>
            Accept
          </Button>
        </div>
      </div>
    </div>
  );
}

