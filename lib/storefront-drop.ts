import type { Drop } from "@prisma/client";

import { effectiveDropStatus } from "@/lib/drops";
import { storefrontDropVisibility, type StorefrontDropVisibility } from "@/lib/storefront-order";

/**
 * Pre-order links, /s/<slug>/preorder/<dropId> (docs/DROP_LINK_PLAN.md): the store
 * page showing one drop only, with a link preview of that drop's items.
 *
 * Which drop a link shows is decided here and nowhere else, for the page, its
 * metadata and its share card alike. The caller passes the drops it already read
 * for one published store (stored-OPEN, from yesterday IST onward), so an id from
 * another store, a draft or a seller-closed drop is simply not among them. The
 * drop must also be one the store page would list (`storefrontDropVisibility`
 * not "hidden": open, scheduled, or closed within its grace window). Anything
 * else is null, and the page shows the whole store with a notice, never a 404.
 */

export type FocusableDrop = Pick<Drop, "id" | "status" | "opensAt" | "closesAt">;

/** A cuid is 25 chars; anything long is not a drop id, so no query is spent on it. */
const MAX_DROP_ID_LENGTH = 64;

export function isPlausibleDropId(dropId: string | null | undefined): dropId is string {
  return !!dropId && dropId.length <= MAX_DROP_ID_LENGTH;
}

export function focusedDropVisibility(
  drop: Pick<FocusableDrop, "status" | "opensAt" | "closesAt">,
  now: Date,
): StorefrontDropVisibility {
  return storefrontDropVisibility(effectiveDropStatus(drop, now), drop.closesAt, now);
}

/** The drop a pre-order link shows, among the store's own drops; null = show the store. */
export function findFocusedDrop<D extends FocusableDrop>(
  drops: readonly D[],
  dropId: string | null | undefined,
  now: Date,
): D | null {
  if (!isPlausibleDropId(dropId)) return null;
  const drop = drops.find((d) => d.id === dropId);
  if (!drop) return null;
  return focusedDropVisibility(drop, now) === "hidden" ? null : drop;
}
