"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { COOKIE_PREF_KEY } from "@/lib/cookie-pref";

/**
 * While shown, the banner publishes its height as `--cookie-banner-h` on
 * <html> so bottom-anchored UI (the storefront cart bar) can sit above it
 * instead of underneath — otherwise a first-time buyer on a phone can't reach
 * Checkout until they dismiss this.
 */
const HEIGHT_VAR = "--cookie-banner-h";
type CookiePref = "accepted" | "declined";

/**
 * Rendered on the server, shown by default. It used to mount only after
 * hydration, which made its paragraph the largest late paint on a phone (the
 * storefront's LCP at ~4.5 s on slow 4G). The stored answer lives in
 * localStorage, which the server can't read, so for returning visitors
 * `COOKIE_PREF_BOOT_SCRIPT` (inline in app/layout.tsx) flags <html> before
 * first paint and app/globals.css hides `[data-cookie-banner]`; the effect
 * below then unmounts it.
 */
export function CookieConsentBanner() {
  const [show, setShow] = useState(true);
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
      data-cookie-banner=""
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/98 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] shadow-lg backdrop-blur-sm print:hidden"
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

