import type { Prisma } from "@prisma/client";

import { itemPhotoList, photoLayout, type PhotoRef } from "@/lib/item-photos";
import { prisma } from "@/lib/prisma";

/**
 * Database side of an item's photos (rules in lib/item-photos.ts). Every query
 * is scoped by `{ vendorId, menuItemId }`; an item of another store reads as
 * missing (null), which the routes turn into 404.
 */

type Db = Prisma.TransactionClient | typeof prisma;

async function readPhotos(db: Db, vendorId: string, menuItemId: string): Promise<PhotoRef[] | null> {
  const item = await db.menuItem.findFirst({
    where: { id: menuItemId, vendorId, archivedAt: null },
    select: {
      imageUrl: true,
      images: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true, url: true } },
    },
  });
  return item ? itemPhotoList(item.imageUrl, item.images) : null;
}

/** The item's photos in order, cover first; null when the item isn't this store's. */
export function loadItemPhotos(vendorId: string, menuItemId: string): Promise<PhotoRef[] | null> {
  return readPhotos(prisma, vendorId, menuItemId);
}

/** Stores `urls` as the item's whole photo list (rule 5): the first is the cover. */
async function writePhotos(tx: Prisma.TransactionClient, vendorId: string, menuItemId: string, urls: readonly string[]) {
  const { cover, extras } = photoLayout(urls);
  await tx.menuItem.update({ where: { id: menuItemId, vendorId }, data: { imageUrl: cover } });
  await tx.menuItemImage.deleteMany({ where: { vendorId, menuItemId } });
  if (extras.length > 0) {
    await tx.menuItemImage.createMany({ data: extras.map((e) => ({ ...e, vendorId, menuItemId })) });
  }
}

export type PhotoChange<T> = { urls: readonly string[]; result: T } | { refuse: T };

/**
 * Runs one change to an item's photos under a row lock on the item, so two
 * tabs can't interleave. `change` sees the current list and returns the new
 * URL list (written as the whole layout) or a refusal (nothing written).
 * Null when the item isn't this store's.
 */
export async function changeItemPhotos<T>(
  vendorId: string,
  menuItemId: string,
  change: (photos: PhotoRef[]) => PhotoChange<T>,
): Promise<{ photos: PhotoRef[]; outcome: T; written: boolean } | null> {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM menu_items WHERE id = ${menuItemId} AND "vendorId" = ${vendorId} FOR UPDATE`;
    if (locked.length === 0) return null;
    const current = (await readPhotos(tx, vendorId, menuItemId)) ?? [];
    const next = change(current);
    if ("refuse" in next) return { photos: current, outcome: next.refuse, written: false };
    await writePhotos(tx, vendorId, menuItemId, next.urls);
    const photos = (await readPhotos(tx, vendorId, menuItemId)) ?? [];
    return { photos, outcome: next.result, written: true };
  });
}
