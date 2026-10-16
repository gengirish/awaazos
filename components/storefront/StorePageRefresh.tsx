"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Re-renders the store page when the browser restores it from the back/forward
 * cache. A buyer who signs in by email link and then taps Back would otherwise
 * see the copy from before they signed in, still saying "Sign in".
 *
 * Only `pageshow` with `persisted` — no visibility listener, no timer — so an
 * open store tab never keeps the database awake.
 */
export function StorePageRefresh() {
  const router = useRouter();

  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) router.refresh();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [router]);

  return null;
}
