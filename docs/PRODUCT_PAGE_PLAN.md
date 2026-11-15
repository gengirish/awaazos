# Product detail and product links plan

Status: step 1 (detail sheet) merged in #205; step 2 (product links) merged in #207; step 3 (photos) in PR #208; step 4 (highlights) built on `feat/item-highlights`; step 5 not started. Written 2026-11-14.

Why: on `/s/[slug]` an item is a row (kitchens) or a tile (goods stores), and that is all a buyer
gets. On a kitchen store the photo and name do nothing when tapped; on a goods store the photo opens
larger and nothing else. There is no page for one product, so a seller who posts one kurti on
Instagram can only link to the whole store, and the buyer has to find the kurti again.

We studied Flipkart's search results and product page (2026-11-14) and kept what fits a home seller
with 5 to 50 items. This plan builds it in five steps, one PR each, merged in order (never stacked).

## What Flipkart does, and what we take

| Flipkart | Take it? | Here |
| --- | --- | --- |
| Product page: gallery, size chips, price, delivery, highlights, Add to cart / Buy now fixed at the bottom | Yes | A detail **sheet** over the store page (step 1), so the cart and checkout stay the ones we have |
| One URL per product with its own link preview | Yes | `/s/<store>/p/<itemId>` + its own preview image (step 2) |
| Several photos per product, swipeable | Yes | Step 3 |
| "Product highlights" (Fabric: Cotton Blend…) and a full description | Yes | Step 4, plus the veg / non-veg mark for kitchens |
| Price with the discount first: **↓38% ~~699~~ ₹436** | Yes | Sheet in step 1, list in step 5 |
| Delivery date from a pincode, "Fulfilled by" | Replaced | Our handover facts: Pickup / Delivery, next slot or pre-order window, ways to pay |
| 10-day return, COD, support icons | Replaced | Same trust row; we show only what the store really offers |
| Sort (Popularity, Price, Newest) and filters | Partly | Sort only, and only for catalogues over 12 items (step 5) |
| "Similar products", ratings per product, Q&A | Not now | Small catalogues; ratings are per store by design (`lib/order-feedback.ts`) |
| Ads, coins, wishlist, sign-in walls, other sellers | No | Not our buyer or our model |
| Tap-through cards with no Add button | No | A small catalogue is faster with Add on the card; the sheet is extra, not required |

## Decisions

1. **A sheet, not a separate page.** The detail opens over the store page in the existing
   `responsive-dialog` (bottom sheet on phones, dialog from `md`). The cart, sizes, stock caps,
   offers preview and checkout already live in `MenuOrder` / `DropOrder`; a second page would need
   them all again. The sheet is rendered by the component that owns the item's cart, so Add in the
   sheet and the stepper on the row are the same state.
2. **The product link uses the item id, not `MenuItem.slug`.** Renaming an item regenerates its slug
   (`PATCH /api/menu/[id]`), so a slug link posted on Instagram would break when the seller fixes a
   typo, and some rows have no slug (the quiche seed script). The id is already public (the
   `menu-item-<id>` row anchors). Link: `/s/<store>/p/<menuItemId>`. No backfill, no migration.
3. **A product link never 404s for a real store.** The route renders the normal store page and opens
   the sheet when the id is among the items that page already shows (everyday menu or an open
   drop). Otherwise (sold out and hidden, made unavailable, a drop that closed, an id from another
   store, garbage) it renders the store page with one quiet line: "That item isn't on sale right
   now." The lookup is only among the page's own loaded items, so no extra query and nothing about
   another store can show. The store's own gates are unchanged: not published → 404, like `/s/[slug]`.
4. **Which row the link opens.** An open drop selling the item wins (the buyer can pre-order it),
   then the orderable everyday menu, then the read-only menu (details, no Add). Decided on the
   server and passed down as `openItem: { kind: "drop", dropId, dropItemId } | { kind: "menu", menuItemId }`.
5. **The address follows the sheet.** Opening a sheet does `history.pushState` to `/s/<store>/p/<id>`
   and closing it goes back, so Share copies the right link and Android Back closes the sheet
   (Next 15 syncs `pushState` with the router). The query string is kept both ways: checkout reads
   `src` from `location.search` (`orderSrcFromSearch`), and an Instagram buyer must stay tagged.
6. **No new reads in steps 1 and 2.** Everything the sheet shows is already on the page. Step 5's
   "ordered N times" is the only new query, one `groupBy` per render on an indexed column
   (`OrderItem @@index([menuItemId])`), no cache, no timer.
7. **Public select stays an allowlist.** New columns (steps 3 and 4) are added to the storefront and
   preview-image selects by name. `costInPaise`, stock counts and tags never reach the page.
   `stableMenuJson()` does not take the new columns, so the voice prompt cache is untouched.
8. **Wording goes through the vocabulary.** "Share this dish" / "Share this product" and the like use
   `storeVocabulary()`; a kitchen reads as it does today.

## Step 1: product detail sheet (no schema change)

Tapping the photo or the name of any item opens the sheet: menu rows, gallery tiles, drop rows and
read-only menu rows. On goods stores this replaces the photo-only dialog (`ItemPhoto enlarge`); the
sheet's photo opens full size instead.

Contents, top to bottom:

- **Photo**, full width (square; the emoji tile when there is none). Tap → full-size view with pinch zoom.
- **Name**, then the price with the discount first: green "↓35%", struck old price, bold price, unit.
  A `variant="emphasis"` on `ItemPrice` so the row keeps its current look until step 5.
- **Badges**: Popular, "Only N left", "Sold out".
- **Size picker** (`SizePicker`) when it has sizes; price and stock follow the picked size.
- **Description**, unclamped (today the row cuts it at two lines).
- **Offers for this item**: the live offers whose ids include it, as the `OfferChips` text
  ("Sale: 35% off", "2+ items → free Bhel Puri"). New pure helper `offersForItem(offers, menuItemId)`
  in `lib/offers.ts`.
- **Trust row**, two or three short lines from what the page already knows:
  - menu item: Pickup (with the pickup note) and/or Delivery (areas summary or fee), next slot;
  - drop item: the handover window (`formatWindowWithDay`) and the cut-off state (`dropStateLabel`);
  - ways to pay (`storeInfoFacts` payment text).
- **Bottom bar, always visible**: price × qty and the `QtyStepper` (Add when zero). Sold out → a
  disabled "Sold out" button. Read-only menu → no bar; the store's pay / contact action stays where it is.

Files:

- New `components/storefront/ItemDetailSheet.tsx`: presentational; takes the item view, a price
  node, sizes node, stepper node, offer lines and trust lines. No cart logic of its own.
- `MenuOrder.tsx` and `DropOrder.tsx`: hold `detailId` state, make photo and name buttons, render
  the sheet with their own stepper and size state.
- Read-only menu: `MenuRow` in `app/s/[slug]/page.tsx` is a server component; wrap the list in a
  small client component that owns `detailId` and renders the sheet without a bar.
- `ItemPhoto.tsx`: the photo becomes the sheet's trigger (an `onOpen` prop) instead of its own dialog.

Accessibility: the trigger is one button around photo + name with `aria-label="Details of <name>"`,
44 px minimum; the sheet's title is the item name; focus returns to the trigger on close;
`aria-live` on the bar's quantity.

Tests: `offersForItem` unit tests. E2E in `e2e/public.spec.ts`: tap a row → sheet → Add → cart
bar shows 1; size pick in the sheet adds the right size; a sold-out item shows no Add.
`e2e/mobile-sweep.spec.ts` covers the sheet's tap targets.

Bundle: `/s/[slug]` is budgeted at 254 kB and already ships the responsive dialog for checkout.
Measure with `npm run perf:budget`; re-record only for a justified growth.

## Step 2: product links and link previews (no schema change)

- **Route** `app/s/[slug]/p/[itemId]/page.tsx`. Move the body of `app/s/[slug]/page.tsx` into a
  shared server function (`renderStorefront({ slug, searchParams, openItemId })`) that both routes
  call; no copy of the 1,500-line page. Same layout, so the store's own manifest and install
  button apply. Store views are counted the same way (`countStoreView`), `src` included.
- **Metadata**: title "<item> · <store>", the item's description (else the store tagline),
  canonical `/s/<store>/p/<id>`, `noindex` on demo stores like the store page.
- **Preview image** `app/s/[slug]/p/[itemId]/opengraph-image.tsx` (and `twitter-image`): item photo
  large, name, price (sale-aware, `Price` from `lib/og-parts.tsx`), store name and logo, "Order
  on AwaazDo". Same gate as the store card; an item not on sale or a hidden store gets the generic
  card, which carries nothing from the URL. Photo loaded with the same timeout pattern as
  `storeLogoDataUrl`; on timeout the emoji layout.
- **Buyer share** in the sheet: "Share" with the device share sheet (plain link) and WhatsApp
  (`buildTaggedWhatsAppShareUrl`, `?src=wa`), like `ShareStoreButton`.
- **Seller share** on `/menu` (`MenuItemCard` "⋯"), for an item shown online in a published store:
  "Copy link for Instagram" (`withInstagramTag`, `?src=ig`) and "Share on WhatsApp" (`?src=wa`).
  Hidden for an unpublished store, with no hint of a broken link.
- Update `lib/help-guide.ts` for the new menu actions and the storefront section of `CLAUDE.md`.

Tests: E2E: `/s/<store>/p/<id>` opens with the sheet open; closing it leaves `/s/<store>` with
`?src=ig` kept; an unknown id and another store's item id both show the store page with the notice
and none of the other store's data (add the second case to `e2e/tenant-isolation.spec.ts`); an
unpublished store's product link is 404; the preview image route answers 200 with `image/png`.

## Step 3: several photos per item (migration)

- **Schema**: model `MenuItemImage { id, vendorId, menuItemId, url, sortOrder, createdAt }`,
  `@@index([vendorId, menuItemId])`, cascade on item delete, at most 6 per item. `MenuItem.imageUrl`
  stays the cover and is always the first photo, so the POS, voice, preview images and receipts
  read nothing new. A model, not a `String[]`, so deletes use a compound `where { id, vendorId }`
  and a colour can get its own photo later (`variantId`, not in this step).
- **API**: `POST /api/menu/[id]/images` (multipart, MANAGER, `lib/blob-image.ts` rules, browser
  downscale first), `DELETE /api/menu/[id]/images/[imageId]` (deletes the blob),
  `PUT /api/menu/[id]/images/order` (ids in order; the first becomes `imageUrl`). No Blob token → 503.
- **Item form**: a photo strip with add, remove, drag or arrow reorder (arrows for keyboard).
- **Sheet**: CSS scroll-snap carousel with dots and "2 / 5", no library. Tiles and rows keep the cover.
- Migration SQL in `prisma/migrations/`, `prisma migrate deploy` on Neon before merge.

Tests: unit tests for the order rule (first = cover); E2E: upload two photos, reorder, the store's
sheet shows both in order; tenant case for the delete route.

As built: the routes are CASHIER, like the single-photo route (whoever can edit an item edits its
photos), not MANAGER. Reorder is arrow buttons only, no drag: they work by keyboard and on a phone.
`GET /api/menu/[id]/images` lists the photos for the form. The E2E seeds photos in the local database
because e2e runs have no Blob token; the reorder goes through the real route.

## Step 4: details, highlights and the veg mark (migration)

- **Schema** on `MenuItem`:
  - `details String? @db.VarChar(1000)`: the longer text, shown in the sheet under the one-line
    `description` (which keeps its 200-character job on rows and in previews).
  - `highlights Json?`: up to 6 `{ label ≤ 24, value ≤ 60 }`, parsed and validated by a pure
    `lib/item-highlights.ts` (zod-free, like `lib/item-variants.ts`, so the store page can import it).
  - `foodType FoodType?` enum `VEG | NON_VEG | EGG`, null = not said. Food stores only.
- **Item form**: "Highlights" with label suggestions by store kind: goods "Fabric", "Size guide",
  "Wash care", "Material"; food "Serves", "Weight", "Shelf life", "Spice level". Free text, the
  suggestions only fill the label.
- **Sheet**: highlights as a two-column grid of label / value, then the details text.
- **Veg mark** on rows, tiles and the sheet, food stores only: green square with a dot (veg), brown
  triangle (non-veg, the FSSAI symbol since 2022), and egg, each with visible or `sr-only` text so
  it never relies on colour. Optional for the seller; nothing shows when null.
- The voice menu builder does not set these yet.

Tests: `item-highlights` unit tests (limits, trimming, empty rows dropped); E2E: save highlights and
a veg mark, see them on the store; public select test that `costInPaise` still never appears.

As built: the mark shows on list rows and in the sheet; gallery tiles are for goods stores, which
never show it. Egg is a filled dot in a yellow square, with the word "Contains egg". Highlights and
details sit in the main item form under the description, kept outside the react-hook-form schema
like stock and cost.

## Step 5: list polish and "ordered N times" (no migration)

- **Price discount-first** on rows and tiles, the same `ItemPrice` variant as the sheet.
- **Portrait tiles** for clothing stores (`stallType` Clothing → 3:4 photos), no new setting.
- **Sort**, only when the visible catalogue has more than 12 items: "Our order" (default, the
  seller's `sortOrder`), "Price: low to high", "Price: high to low", "Newest". Sorting by price or
  newest shows one list without category headings; "Our order" brings them back. Client-side,
  remembered per store on the device. Needs `createdAt` in the public select.
- **"Ordered 25+ times"**: one `orderItem.groupBy` over the last 30 days per page render: paid or
  stock-holding orders, not cancelled, not samples, gift lines excluded. Shown in steps only (10+,
  25+, 50+, 100+), never the exact number, nothing below 10, never on demo stores. Display only:
  it never sets `isPopular` and nothing is stored.

Tests: pure helpers for sort and the count steps; E2E on a seeded 13-item store: the sort control
shows, price sort reorders, 12 items show no control.

## How we know it works

- `/admin/metrics` already counts store views and orders by channel (`lib/order-funnel.ts`). After
  step 2, compare Instagram-tagged orders per store view before and after.
- Watch whether sellers use "Copy link for Instagram" by checking product-link views in Vercel analytics (`/s/*/p/*`).
- Real-phone check after steps 1 and 2: open a product link from Instagram's in-app browser and from
  WhatsApp, add from the sheet, Back closes the sheet, checkout carries `orderChannel`.

## Not in this plan

Per-product ratings and reviews, similar products, wishlist, filters by colour or price range,
pincode checks, a photo per colour, video, buyer Q&A, and item links from the POS or receipts.
