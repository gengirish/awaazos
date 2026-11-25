# /menu: filter and group by category

Status: built on `feat/menu-category-filter` (2026-11-25). A–Z order and a lower search threshold agreed.

## What is there today

- `/menu` (`app/(vendor)/menu/page.tsx` → `MenuScreen` → `MenuGrid`) is **one flat grid** in `sortOrder`.
- Search and the All / Selling / Sold out / Low stock filter (`lib/menu-search.ts`) show **only above 15 items**
  (`STAFF_SEARCH_MIN_ITEMS`). A smaller store sees no filter at all, which is probably what the seller ran into.
- A search word matches the category text, but no control picks a category.
- MANAGER and up see a row "Categories: tap one to rename it". It only renames. It does not filter.
- The store page (`app/s/[slug]/storefront-view.tsx`) orders by `category` A–Z, then `sortOrder`, and groups.
  The POS (`QuickAddGrid`) groups past 8 tiles, in the order each category first appears.
  So moving a card past an item of another category on `/menu` changes nothing buyers see: the seller's grid
  doesn't match the store.

## Goal

The seller sees their catalogue the way buyers do, in sections by category, and can show one category at a time.
A store with a single category (every kitchen still on "General") reads exactly as today.

## Decisions (recommended)

1. **Category order is A–Z, the same as the store page.** The order comes from the database
   (`orderBy: [{ category: "asc" }, { sortOrder: "asc" }]`), not from JS sorting, so `/menu` and `/s/<slug>` can never
   disagree on collation. Letting sellers choose the category order needs a new table and a migration, and the store
   page would have to change too. That is a later step (see "Not in this plan").
2. **Category chips show whenever there are 2 or more categories, at any item count.** They do not wait for the
   15-item search threshold.
3. **The chips replace the rename row.** Rename moves to a pencil button on each section heading (MANAGER and up). It
   keeps the accessible name "Rename category X", so `e2e/menu-crud.spec.ts` keeps working. Two rows of the same
   category names would be clutter.
4. **Moving cards stays inside a section.** The arrows and drag move a card only among its own category. To move an
   item to another section, the seller changes its category in Edit. The save is unchanged: the whole list, flattened
   section by section, goes to `POST /api/menu/reorder`.
5. **Moving still works while a category chip is on.** One category is a whole section with nothing hidden inside it.
   Moving stays off while a search word or a status filter hides cards, the same as today.

## Steps

### 1. Pure helpers (`lib/menu-category.ts`, `lib/menu-search.ts`)

- `groupMenuRows(rows)` returns `{ category, items }[]` in the order the rows came, with no re-sort. A blank category
  reads as "General", the column default.
- `MenuFilter` gains `category: string | null`. `menuItemMatches` checks it first. `isMenuFilterEmpty` counts it.
- Add `hidesCards(filter)`, true when terms or status are set. It decides whether moving is off; a category alone
  doesn't count.
- `moveWithinCategory(rows, id, direction)` returns the new full list, or null at the edge of the section.
- Update the header comments of both files with the rules above.
- Unit tests: `lib/__tests__/menu-search.test.ts`, plus a new `lib/__tests__/menu-category.test.ts`.

### 2. Order the rows like the store

- `/menu` page query and `GET /api/menu` (`app/api/menu/route.ts:34`) switch to
  `[{ category: "asc" }, { sortOrder: "asc" }]`. `MenuScreen` / `MenuGrid` read their rows again from that GET, so
  both have to change together.
- Check the other GET callers: `OnboardingForm.tsx:269` and `:342`. They read items, not order, but confirm.
- After the first save, `sortOrder` is renumbered section by section. The POS then shows its groups in the same
  A–Z order too, with no POS change.

### 3. UI (`components/menu/MenuGrid.tsx`)

- **Category chips**: a `radiogroup` "Category" with All, then "Snacks 6", …, built from `RadioOption size="compact"`
  (44 px), wrapping like today's rename row. The state is local. If the chosen category disappears (renamed or
  deleted), the chips show All, using the same pattern as `shownStatus`.
- **Sections**: each is `<section aria-labelledby>` with an `<h2>` heading showing the name and count, the rename pencil
  for managers, and its own `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`. With one category there is no heading
  and no chips, the same look as today.
- **Search and status**: same threshold and same controls. They combine with the chip. A section that the filter
  empties is hidden. The empty state names the category ("No sold out items in Snacks") and its button clears all
  three filters. The `aria-live` count stays.
- **Moving**: `canMoveUp` / `canMoveDown` come from the card's index inside its section, not the whole list. A drop
  on a card in another section is ignored, and a hint line says "To move an item to another section, change its
  category in Edit". Refocus after a move works as today (`data-move`).
- Keep the new code small and add no dependencies: `/menu` is close to its bundle budget (304 kB in
  `perf-budget.json`). Measure with `npm run build && npm run perf:budget`.

### 4. Words

- `lib/help-guide.ts`: "rename-category" (rename is now on the section heading) and the search entry (category chips,
  and moving works with a category chosen).
- `.cursor/rules/catalogue.mdc`: one short paragraph on the /menu sections and chips, then
  `npm run sync:agent-rules`.

### 5. Tests

- E2E `e2e/menu-categories.spec.ts`: a store with items in 2 categories shows both headings in A–Z order, a chip
  shows only its section, the arrows are disabled at a section's edge, and a move inside the section is saved (the
  order survives a reload). A single-category store has no chips and no headings.
- `e2e/menu-crud.spec.ts` rename test: same button name, now inside the heading. Check that it still passes.
- `e2e/mobile-sweep.spec.ts`: chips and the heading pencil are 44 px (mobile project).
- Before pushing: `npm test && npm run typecheck && npm run lint && npm run build && npm run perf:budget`. No schema
  change, so no migration.

## Not in this plan

- **Seller-chosen category order** (for example "Mains before Desserts"). It needs a `MenuCategory` table, or an order
  column, plus a migration, and the store page and POS would change with it. Worth doing if sellers ask; A–Z covers
  most menus.
- Remembering the chosen category between visits, or putting it in the URL (`?category=`).
- Moving an item between sections by dragging.

## Search threshold (decided)

Search and Selling / Sold out now show from 6 items (`MENU_FILTER_MIN_ITEMS` in `lib/menu-search.ts`), down from
more than 15. The POS search keeps `STAFF_SEARCH_MIN_ITEMS` (15): its tiles are small.
