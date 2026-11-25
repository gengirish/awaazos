/**
 * Menu categories: the free text on `MenuItem.category` ("Snacks", "Rings"). Zod-free,
 * so the /menu screen can import it without pulling zod into its first load.
 *
 * Renaming (PATCH /api/menu/categories, MANAGER) rewrites it on every item on the menu
 * that has exactly that text; typing a name already in use merges the two. Deleted items
 * (lib/menu-archive.ts) keep their old category.
 *
 * Sections on /menu (docs/MENU_CATEGORY_FILTER_PLAN.md):
 *
 * 1. The list shows one section per category, in the order the rows arrive. The page and
 *    GET /api/menu order by category A–Z, then `sortOrder`: the same order as the store
 *    page, so the seller's screen and the buyer's never disagree. Nothing here re-sorts.
 * 2. A blank category reads as "General", the column default.
 * 3. A card moves only inside its own section. Moving it to another section is a change
 *    of category, made in the item form. The order saved (POST /api/menu/reorder) is the
 *    whole menu, section by section.
 * 4. With one category there are no sections: the list reads as it always did.
 */

/** Longest category name: the 80 characters the item form already allows. */
export const MENU_CATEGORY_MAX = 80;

/** What a blank category is shown and grouped as. */
export const DEFAULT_MENU_CATEGORY = "General";

/** The categories on screen, in the order their first item appears; blanks left out. */
export function menuCategories(items: readonly { category?: string | null }[]): string[] {
  const seen = new Set<string>();
  for (const item of items) {
    if (item.category && item.category.trim()) seen.add(item.category);
  }
  return [...seen];
}

/** The section an item sits in (rule 2). */
export function menuCategoryOf(item: { category?: string | null }): string {
  return item.category && item.category.trim() ? item.category : DEFAULT_MENU_CATEGORY;
}

export type MenuSection<T> = { category: string; items: T[] };

/** One section per category, in the order each first appears; rows keep their order inside (rule 1). */
export function groupMenuRows<T extends { category?: string | null }>(rows: readonly T[]): MenuSection<T>[] {
  const sections = new Map<string, T[]>();
  for (const row of rows) {
    const category = menuCategoryOf(row);
    const list = sections.get(category);
    if (list) list.push(row);
    else sections.set(category, [row]);
  }
  return [...sections.entries()].map(([category, items]) => ({ category, items }));
}

/** The whole list again, section by section: what a reorder saves (rule 3). */
export function flattenMenuSections<T>(sections: readonly MenuSection<T>[]): T[] {
  return sections.flatMap((section) => section.items);
}

/**
 * Move one row up or down inside its section (rule 3). Returns the whole list,
 * section by section, or null when the row is not there or already at that edge.
 */
export function moveWithinCategory<T extends { id: string; category?: string | null }>(
  rows: readonly T[],
  id: string,
  direction: "up" | "down",
): T[] | null {
  const sections = groupMenuRows(rows);
  for (const section of sections) {
    const from = section.items.findIndex((row) => row.id === id);
    if (from < 0) continue;
    const to = direction === "up" ? from - 1 : from + 1;
    if (to < 0 || to >= section.items.length) return null;
    const items = [...section.items];
    [items[from], items[to]] = [items[to], items[from]];
    section.items = items;
    return flattenMenuSections(sections);
  }
  return null;
}

/**
 * Drop one row onto another (drag to reorder): it takes the other's place in the
 * section. Null when either is missing, they are the same row, or they sit in
 * different sections (rule 3: that is a change of category, not of order).
 */
export function dropWithinCategory<T extends { id: string; category?: string | null }>(
  rows: readonly T[],
  dragId: string,
  dropId: string,
): T[] | null {
  if (dragId === dropId) return null;
  const sections = groupMenuRows(rows);
  for (const section of sections) {
    const from = section.items.findIndex((row) => row.id === dragId);
    if (from < 0) continue;
    const to = section.items.findIndex((row) => row.id === dropId);
    if (to < 0) return null;
    const items = [...section.items];
    const [moved] = items.splice(from, 1);
    items.splice(to, 0, moved);
    section.items = items;
    return flattenMenuSections(sections);
  }
  return null;
}
