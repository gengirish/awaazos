/**
 * Deleting a menu item ("Delete dish" / "Delete product"). Pure and client-safe.
 *
 *   1. **A delete is an archive.** DELETE /api/menu/[id] (MANAGER, the same bar as the
 *      /menu tab) stamps `MenuItem.archivedAt` and switches `isAvailable` off. The row
 *      stays, so old bills (`OrderItem` keeps its own name and price), drop orders, packing
 *      lists, stock records and analytics keep resolving. There is no undo.
 *   2. **Gone from every list.** Every query that lists the catalogue (seller /menu, POS
 *      tiles, the voice prompt, the store page and product links, drop and offer pickers,
 *      story images) filters `ON_MENU`. A route that edits one item answers 404 for an
 *      archived one, as for another vendor's id.
 *   3. **Not while a pre-order sells it.** A drop lists its items explicitly and sells them
 *      whatever `isAvailable` says, so the delete is refused (409 `in_open_drop`) while the
 *      item is in a drop that is a draft, opens later or is taking orders
 *      (`dropBlocksArchive`, on the effective status: no timer). A closed or older drop
 *      keeps its row and its orders; it can't be reopened while it holds a deleted item
 *      (409 `has_deleted_items`), and duplicating it leaves the item out.
 *   4. **The name is free again.** Nothing is unique on the name; the slug of a new item
 *      with the same name gets the usual "-2" suffix (`deduplicateSlug`).
 */

/** Prisma `where` fragment: the item is on the menu (not deleted). */
export const ON_MENU = { archivedAt: null } as const;

/** Drop statuses (effective, lib/drops.ts) in which a deleted item could still be sold. */
const BLOCKING_DROP_STATUSES: ReadonlySet<string> = new Set(["DRAFT", "SCHEDULED", "OPEN"]);

/** Rule 3: does a drop in this effective status stop its items from being deleted? */
export function dropBlocksArchive(effectiveStatus: string): boolean {
  return BLOCKING_DROP_STATUSES.has(effectiveStatus);
}

/** The confirm sheet's question: "Delete Samosa?". */
export function deleteItemTitle(name: string): string {
  return `Delete ${name}?`;
}

/** What the seller is told when a pre-order still sells the item (409 `in_open_drop`). */
export function inOpenDropMessage(dropTitles: readonly string[]): string {
  const named = dropTitles.filter((t) => t.trim()).map((t) => `“${t.trim()}”`);
  if (named.length === 0) return `It is in a pre-order that is still open. Remove it from there first.`;
  if (named.length === 1) return `It is in the pre-order ${named[0]}. Remove it from there first.`;
  return `It is in the pre-orders ${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}. Remove it from those first.`;
}
