# Pre-order links plan

Status: built on `feat/drop-share-link` (2026-11-23): unit tests, build, bundle budget and E2E
(both projects) green locally; not yet merged. Written 2026-11-23.

Why: "Share this pre-order" (`components/drops/ShareDropButton.tsx`) shares the store link `/s/<slug>`,
and the store's link preview (`app/s/[slug]/share-card/store-card.tsx`) draws whichever drop closes
first. A store with two pre-orders open ("Saturday Bakes" and "Diwali Hampers") sends two messages
with the same preview, and one of them lists the wrong items. Buyers who tap land on the whole store
and have to find the pre-order they were sent.

The product links (`/s/<slug>/p/<itemId>`, `docs/PRODUCT_PAGE_PLAN.md` step 2, and the versioned
share cards of #247) already solve this for one item. This plan does the same for one drop.
No schema change, no migration.

## Decisions

1. **The link is `/s/<slug>/preorder/<dropId>`.** "Drop" is the code's word only (CLAUDE.md); buyers
   read "Pre-order", and the address is something they see. The drop id is already public (the store
   page's `drop-<id>` anchors, the order API body), and it is always looked up with the slug's
   `vendorId`, so another store's drop id never matches.
2. **Focus mode.** The page shows only that drop's section: no other pre-orders, no everyday menu,
   no category pills. A "See everything from <store>" link goes to `/s/<slug>`. Each drop and the
   menu check out separately anyway, so nothing a buyer could do is lost.
3. **A pre-order link never 404s for a published store.** A draft, a drop past the closed grace
   window, or an id that isn't this store's renders the whole store with one line: "This pre-order
   isn't taking orders. Here is what's on now." An unpublished or unknown store 404s like `/s/<slug>`.
   A drop that is still in its closed grace window shows in focus with its "Closed" state, as on the
   store page.
4. **Its own preview card, showing only that drop.** `/s/<slug>/preorder/<dropId>/share-card?v=…`
   draws the drop variant of the store card (title, up to four items with prices and "+N more",
   "Order by …", handover window), for that drop only. `v` is a hash of what the card draws, the
   drop's visibility included, so an edit or a close gives crawlers a new URL (`lib/share-card.ts`).
   A drop that no longer shows draws the store's own card; an unpublished store the generic one.
5. **`noindex`.** Pre-order pages expire in days; search engines get the store page.
6. **Text rows, no item photos in the card yet.** Same look as today's store card. Photo tiles for
   goods stores can come later.

## What changes

| Piece | Where |
| --- | --- |
| Loader: one published store's drop as a link preview sees it (same gates as the page, allowlist select) | `lib/storefront-drop.ts` |
| Page: `StorefrontView` with `focusDropId` | `app/s/[slug]/preorder/[dropId]/page.tsx`, `app/s/[slug]/storefront-view.tsx` |
| Card: shared drop layout, store card and drop card both use it | `app/s/[slug]/share-card/store-card.tsx`, `app/s/[slug]/preorder/[dropId]/share-card/` |
| Paths: `dropShareCardPath`, `dropLinkPath` | `lib/share-card.ts`, `lib/drops-share.ts` |
| Seller: the share message, WhatsApp and story link carry the drop link | `components/drops/ShareDropButton.tsx` |
| Rules | `.cursor/rules/storefront.mdc`, `.cursor/rules/drops-orders.mdc` (then `npm run sync:agent-rules`) |

## Tests

- Unit: path helpers, the card version, the loader's visibility mapping.
- E2E (`e2e/public.spec.ts` or a new `e2e/preorder-link.spec.ts`): a store with two open drops; drop
  A's link shows only A's items, its `og:image` points at `/preorder/<A>/share-card?v=` and returns a
  PNG; a draft drop's id shows the store with the notice; vendor B's drop id under vendor A's slug
  shows A's store with the notice and none of B's items.

## After merge

Share a Sam Store pre-order on WhatsApp and check the preview lists only that drop's items.
