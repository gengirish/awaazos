"use client";

import { useEffect } from "react";

/**
 * The address bar follows an item's detail sheet on /s/[slug]
 * (docs/PRODUCT_PAGE_PLAN.md, decision 5):
 *
 * - opening a sheet from a tap pushes `/s/<slug>/p/<menuItemId>`, so Share and
 *   a copied address name the item, and the phone's Back closes the sheet;
 * - closing it goes back to the store's address: `history.back()` when the
 *   push was ours, else (the page was opened on a product link) a replace;
 * - the query string comes along both ways. Checkout reads `src` from
 *   `location.search` (`orderSrcFromSearch`), so an Instagram buyer stays
 *   tagged. The hash is dropped: it points at a row of the store page.
 *
 * Next 15 keeps its router in step with native `pushState` / `replaceState`, so
 * nothing re-renders or refetches. The link uses the item id, never
 * `MenuItem.slug` (decision 2: a rename regenerates the slug).
 */

/** `/s/<slug>/p/<menuItemId>`: the shareable product link. */
export function itemDetailPath(slug: string, menuItemId: string): string {
  return `/s/${encodeURIComponent(slug)}/p/${encodeURIComponent(menuItemId)}`;
}

function storePath(slug: string): string {
  return `/s/${encodeURIComponent(slug)}`;
}

function onItemPath(slug: string): boolean {
  return window.location.pathname.startsWith(`${storePath(slug)}/p/`);
}

// Whether the item address now showing was pushed by a tap on this page (then Back undoes it).
let pushedByTap = false;

/** A sheet opened from a tap. */
export function enterItemUrl(slug: string, menuItemId: string): void {
  const path = itemDetailPath(slug, menuItemId);
  if (window.location.pathname === path) return;
  if (onItemPath(slug)) {
    window.history.replaceState(null, "", path + window.location.search);
    return;
  }
  window.history.pushState(null, "", path + window.location.search);
  pushedByTap = true;
}

/** A sheet closed (button, overlay, Escape). Nothing to do when Back already closed it. */
export function leaveItemUrl(slug: string): void {
  if (!onItemPath(slug)) return;
  if (pushedByTap) {
    pushedByTap = false;
    window.history.back();
    return;
  }
  window.history.replaceState(null, "", storePath(slug) + window.location.search);
}

/** The phone's Back while a sheet is open: the address is the store's again, so close it. */
export function useCloseOnBack(slug: string, open: boolean, close: () => void): void {
  useEffect(() => {
    if (!open) return;
    const onPop = () => {
      if (!onItemPath(slug)) {
        pushedByTap = false;
        close();
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [slug, open, close]);
}
