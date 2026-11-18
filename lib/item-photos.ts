/**
 * Several photos per catalogue item (docs/PRODUCT_PAGE_PLAN.md step 3). Pure and
 * client-safe; the database side is lib/item-photos-server.ts.
 *
 * Rules:
 * 1. `MenuItem.imageUrl` is the cover and always the first photo. The extra photos
 *    are `MenuItemImage` rows in `sortOrder`. The POS, voice, receipts and link
 *    previews read only the cover, so they never change.
 * 2. At most MAX_ITEM_PHOTOS in all, cover included.
 * 3. An item with no cover has no extra photos: adding a first photo makes it the
 *    cover, and removing the cover moves the next photo up.
 * 4. A reorder names every photo exactly once (by `PhotoRef.id`, the cover is
 *    `COVER_ID`), else it is refused: the list changed in another tab.
 * 5. Every change writes the whole layout (`photoLayout`) inside one locked
 *    transaction, so concurrent edits can't leave gaps or two covers.
 */

export const MAX_ITEM_PHOTOS = 6;

/** The cover's id in a photo list; extra photos use their row id. */
export const COVER_ID = "cover";

export type PhotoRef = { id: string; url: string };

/** The item's photos in order: the cover, then the extras. Extras with no cover are listed as they are (rule 3 repairs it on the next write). */
export function itemPhotoList(cover: string | null, extras: readonly PhotoRef[]): PhotoRef[] {
  return cover ? [{ id: COVER_ID, url: cover }, ...extras] : [...extras];
}

/** Photo URLs for a buyer's page: the cover, then the extras. Empty when there is no cover (rule 3). */
export function photoUrls(cover: string | null, extraUrls: readonly string[]): string[] {
  return cover ? [cover, ...extraUrls] : [];
}

/** Whether one more photo fits (rule 2). */
export function canAddPhoto(count: number): boolean {
  return count < MAX_ITEM_PHOTOS;
}

/** The URLs in `order`, or null unless it names every photo of `list` exactly once (rule 4). */
export function reorderPhotos(list: readonly PhotoRef[], order: readonly string[]): string[] | null {
  if (order.length !== list.length || new Set(order).size !== order.length) return null;
  const byId = new Map(list.map((p) => [p.id, p.url]));
  const urls: string[] = [];
  for (const id of order) {
    const url = byId.get(id);
    if (url === undefined) return null;
    urls.push(url);
  }
  return urls;
}

/** The URLs left after removing `id`, or null when it isn't in the list. */
export function removePhoto(list: readonly PhotoRef[], id: string): string[] | null {
  if (!list.some((p) => p.id === id)) return null;
  return list.filter((p) => p.id !== id).map((p) => p.url);
}

/** Moves the photo at `index` one place left (-1) or right (+1); returns the new id order. */
export function movePhoto(ids: readonly string[], index: number, step: -1 | 1): string[] {
  const to = index + step;
  if (index < 0 || index >= ids.length || to < 0 || to >= ids.length) return [...ids];
  const next = [...ids];
  [next[index], next[to]] = [next[to]!, next[index]!];
  return next;
}

/** How a list of URLs is stored: the first is the cover, the rest extra rows in order (rule 1). */
export function photoLayout(urls: readonly string[]): { cover: string | null; extras: { url: string; sortOrder: number }[] } {
  const [cover = null, ...rest] = urls.slice(0, MAX_ITEM_PHOTOS);
  return { cover, extras: rest.map((url, sortOrder) => ({ url, sortOrder })) };
}
