"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { LEGACY_SETTINGS_ANCHORS } from "@/lib/settings-overview";

/**
 * Settings used to be one long page with anchors (`/settings#storefront`).
 * Bookmarks and old links still carry them; send those to the section page.
 */
export function LegacyAnchorRedirect() {
  const router = useRouter();
  useEffect(() => {
    function follow() {
      const target = LEGACY_SETTINGS_ANCHORS[window.location.hash.replace(/^#/, "")];
      if (target) router.replace(target);
    }
    follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, [router]);
  return null;
}
