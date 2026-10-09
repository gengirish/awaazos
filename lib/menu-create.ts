/**
 * Shared create path for menu items: slug, aliases and sortOrder are computed
 * the same way whether a row comes from POST /api/menu (one item from the
 * form) or POST /api/menu/bulk (the voice menu builder).
 *
 *   const ctx = await loadMenuCreateContext(db, vendorId);
 *   const data = prepareMenuItemCreate(ctx, vendorId, input); // reserves slug + sortOrder in ctx
 *   await db.menuItem.create({ data });
 *
 * `prepareMenuItemCreate` mutates `ctx` so several rows prepared from one
 * context get distinct slugs and consecutive sort orders.
 */

import type { Prisma, PrismaClient } from "@prisma/client";

import { deduplicateSlug, generateSlug, suggestAliases } from "@/lib/menu-suggestions";

type MenuDb = Pick<PrismaClient, "menuItem"> | Prisma.TransactionClient;

export type MenuCreateContext = {
  /** Slugs already used by this vendor (plus the ones reserved by earlier prepares). */
  slugs: Set<string>;
  /** sortOrder for the next created row. */
  nextSortOrder: number;
};

export type MenuItemCreateFields = {
  name: string;
  priceInPaise: number;
  aliases: string[];
  tags: string[];
  emoji: string;
  category: string;
  hsnCode: string | null;
  isPopular: boolean;
  isAvailable: boolean;
  showOnline: boolean;
};

/** Every slug the vendor uses, and the sortOrder after the current last item. */
export async function loadMenuCreateContext(db: MenuDb, vendorId: string): Promise<MenuCreateContext> {
  const [existingItems, maxSort] = await Promise.all([
    db.menuItem.findMany({ where: { vendorId }, select: { slug: true } }),
    db.menuItem.aggregate({ where: { vendorId }, _max: { sortOrder: true } }),
  ]);
  return {
    slugs: new Set(existingItems.map((r) => r.slug).filter((s): s is string => s !== null)),
    nextSortOrder: (maxSort._max.sortOrder ?? -1) + 1,
  };
}

/** Auto-suggested aliases merged with the given ones, deduplicated (suggestions first). */
export function mergeMenuAliases(name: string, aliases: readonly string[]): string[] {
  return Array.from(new Set([...suggestAliases(name), ...aliases]));
}

/** Create data for one row; reserves its slug and sortOrder in `ctx`. */
export function prepareMenuItemCreate(
  ctx: MenuCreateContext,
  vendorId: string,
  input: MenuItemCreateFields,
): Prisma.MenuItemUncheckedCreateInput {
  const slug = deduplicateSlug(generateSlug(input.name), ctx.slugs);
  ctx.slugs.add(slug);
  const sortOrder = ctx.nextSortOrder;
  ctx.nextSortOrder += 1;
  return {
    vendorId,
    name: input.name,
    slug,
    aliases: mergeMenuAliases(input.name, input.aliases),
    tags: input.tags,
    priceInPaise: input.priceInPaise,
    emoji: input.emoji,
    category: input.category,
    hsnCode: input.hsnCode,
    isPopular: input.isPopular,
    isAvailable: input.isAvailable,
    showOnline: input.showOnline,
    sortOrder,
  };
}
