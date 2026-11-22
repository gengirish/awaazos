/**
 * Menu categories: the free text on `MenuItem.category` ("Snacks", "Rings"). Zod-free,
 * so the /menu screen can import it without pulling zod into its first load.
 *
 * Renaming (PATCH /api/menu/categories, MANAGER) rewrites it on every item on the menu
 * that has exactly that text; typing a name already in use merges the two. Deleted items
 * (lib/menu-archive.ts) keep their old category.
 */

/** Longest category name: the 80 characters the item form already allows. */
export const MENU_CATEGORY_MAX = 80;

/** The categories on screen, in the order their first item appears; blanks left out. */
export function menuCategories(items: readonly { category: string | null | undefined }[]): string[] {
  const seen = new Set<string>();
  for (const item of items) {
    if (item.category && item.category.trim()) seen.add(item.category);
  }
  return [...seen];
}
