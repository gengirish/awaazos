# UX fixes from the November 2026 design review

The design review of the landing page, the buyer storefront, checkout and the
seller dashboard asked for fixes in three phases. This file records what each
phase changed, the decisions taken where the brief left a choice, what in the
brief did not match the code, and the open decisions for the founder.

## Phase 1: conversion and demo quality

| Item | What shipped | Where |
| --- | --- | --- |
| 1.1 Checkout asks "when" | Weekly slots for everyday-menu orders in Settings → Online orders → Pickup and delivery times. With slots set, checkout requires one; the server re-derives it from the rules. Drop orders show the drop's one window, read-only, for pickup and delivery alike. The slot shows on the order card, the order page and the WhatsApp texts. Menu orders without a slot read "No slot selected". | `lib/menu-slots.ts`, `components/settings/MenuSlotsClient.tsx`, `components/storefront/StorefrontCheckout.tsx`, `lib/menu-orders.ts` |
| 1.2 Address in parts | Address line and locality (required), landmark and pincode (optional, 6 digits). `Transaction.deliveryAddress` stays the whole address; the parts sit beside it. Locality leads on the order card and the packing list. | `lib/delivery-address.ts`, `lib/customer-backfill.ts` |
| 1.3 Day with every time | `formatWindowWithDay`: "Today · 5–9 pm", "Tomorrow · …", "Sat 8 Nov · …" (IST). Used wherever a buyer or seller reads a window on a page. | `lib/drops-time.ts` |
| 1.4 A reason on every drop state | "Opens tomorrow 6:00 pm", "Cut-off passed (today 9:00 pm)", "Sold out", "Closed by you" ("Closed by the store" for buyers). /drops: "Open orders" on upcoming drops not taking orders, Share on open ones, "Copy for tomorrow" primary only on past drops. | `lib/drop-state.ts`, `app/(vendor)/drops/page.tsx` |
| 1.5 Open drops up top | Already built (see below). Added: the countdown past 48 hours ("1 day 4 h left") and a slim teaser for a drop that opens later. | `lib/storefront-order.ts`, `app/s/[slug]/page.tsx` |
| 1.6 Demo store fixture | `npm run seed:demo-store`: four presets (bakery, meals, wellness, crafts), name and city as options, idempotent, demo stores only. | `lib/demo-fixture.ts`, `lib/demo-fixture-server.ts`, `scripts/seed-demo-store.ts`, `public/demo/*.svg` |

Migration: `20261108000000_checkout_slot_address`. Every column is nullable or
has a default (`VendorSettings.menuSlots`, `Customer.saved{Locality,Landmark,Pincode}`,
`Transaction.{fulfilUntil,deliveryLocality,deliveryLandmark,deliveryPincode}`).

### Demo store command

```bash
npm run seed:demo-store -- --category=bakery --city=Hyderabad              # dry run, writes nothing
npm run seed:demo-store -- --category=bakery --city=Hyderabad --create     # local database
npm run seed:demo-store -- --category=wellness --city=Bengaluru --name="Tulsi & Thyme" --create --allow-remote
```

`--allow-remote` is needed for any database that isn't local (production
included). The script refuses a store link that belongs to a real store, so
`sampreeti-store` and every seller's store are out of its reach.

## Phase 2: seller efficiency and polish

| Item | What shipped | Where |
| --- | --- | --- |
| 2.1 Gifts merged in "To make" | A free-item gift joins its item's chip: "2 × Bhel (1 free)". Lines group by menu item (by name when the item was deleted), so a renamed dish stays one row. The drop prep sheet already counted gifts in the item's total; it now says how many are free, as does the board's "To cook" line. | `lib/menu-orders-board.ts`, `lib/drops-board.ts` (`qtyFree`), `giftBaseName` in `lib/offers.ts` |
| 2.2 Delivery areas | Settings → Online orders → Delivery areas: up to 20 localities, each with its own fee or the usual one. With areas set, checkout offers them as a list instead of a typed locality, both order paths refuse any other locality (`outside_delivery_area`) and charge that area's fee, and the store page reads "Free delivery in Kondapur, Gachibowli · ₹40 delivery in Madhapur". | `lib/delivery-areas.ts`, `components/settings/DeliveryAreasClient.tsx`, `lib/drops.ts`, `lib/menu-orders.ts` |
| 2.3 Store polish nudge | One-time banner on /orders for the owner of a published store: test-named items buyers can see ("Test item", "testing 2"), else no tagline. "Got it" hides that reason on the device for good. | `storePolishNudge` in `lib/orders-banner.ts`, `lib/store-polish-server.ts`, `components/setup/StorePolishBanner.tsx` |
| 2.4 Copy | /drops subtitle "Pre-order menus with a cut-off…". Sound button: "Order sounds on", "Order sounds off — tap to turn on", and "Order sounds on — tap once to allow" while the browser waits for a tap. The checkout WhatsApp box is ticked by default, with "So the store sees it instantly." The order card drops "Cash" under the amount when the pill says "Pay on delivery". | `app/(vendor)/drops/page.tsx`, `OrdersBoard.tsx`, `StorefrontCheckout.tsx`, `OrderCard.tsx` |
| 2.5 Survey prompt | /orders only (gone from /drops), once per browser session, "Not now" holds for 14 days. Settings → Tell us what's hard and the Help guide keep it. | `components/drops/orders/OrdersBannerSlot.tsx`, `SURVEY_SNOOZE_DAYS` |
| 2.6 Storefront header | Share moved into the sticky category bar (an icon beside search), so it stays on screen with "Top". A store with no bar keeps Share in the header. | `app/s/[slug]/page.tsx`, `ShareStoreButton` (`compact`), `StoreSearchBar` (`trailing`) |

Migration: `20261109000000_delivery_areas` (`VendorSettings.deliveryAreas JSONB NOT NULL DEFAULT '[]'`).

### Phase 2 decisions

10. **Areas, not a radius.** An order has a locality, not coordinates, so there
    is nothing to measure a radius from. Areas match on letters and digits only,
    so "Gachi-bowli" is Gachibowli and an old saved locality still matches.
11. **Out-of-area delivery is blocked, not warned.** With areas set, checkout
    offers only them (no typo to refuse), and the server refuses any other
    locality, so the fee is never a guess. Pickup is untouched. A store with no
    areas works as before.
12. **One list for drops and menu orders.** An area's fee replaces the drop's
    or the menu's fee for that area; an area with no fee uses it.
13. **"Default tagline" means no tagline.** Nothing generates one (see below),
    so the nudge asks for a tagline when there is none, after test items.
14. **The WhatsApp box stays unticked on stores that take online payment.**
    Ticked, it sends the buyer to WhatsApp before the Razorpay window, and
    "Buyers pay online" is the default story.
15. **Share joins the sticky bar instead of a second sticky row.** One sticky
    bar keeps the menu visible on a 360 px phone.

## Decisions taken (the brief left the choice)

1. **Slots are a weekly pattern.** Each rule is some weekdays and one IST window
   ("Tue–Sat · 11 am – 1 pm"), up to 10 rules. Checkout lists the next 7 days and
   drops any slot starting within 60 minutes (`SLOT_DAYS_AHEAD`, `SLOT_LEAD_MINUTES`).
   No per-slot capacity: none was asked for.
2. **The slot is stored on the order** as `fulfilAt` (start, an existing column)
   and the new `fulfilUntil` (end). Drop orders store nothing: the drop's window
   is the slot, and a seller who edits it moves every order with it.
3. **No slot picked yet is the default.** The buyer must choose; a pre-picked
   first slot would book times people didn't mean.
4. **The whole address stays in one column.** `deliveryAddress` is the line,
   landmark, locality and pincode joined, so the rider handoff, WhatsApp texts
   and order pages kept working unchanged. Old orders and old saved addresses
   keep their single line: it shows as the address line, and the next checkout
   asks for the locality once.
5. **The server doesn't require the locality.** A checkout page loaded before
   this deploy can still place its order. The checkout itself requires it.
6. **Manual close vs cut-off.** A drop closed while its cut-off was still ahead
   reads "Closed by you"; once the cut-off has passed it reads "Cut-off passed",
   however it closed.
7. **Demo stores use the internal API's own path.** The script calls
   `createDemoStore` (owned by `DEMO_OWNER_EMAIL`, `demo@upi`, no trial), then
   `applyDemoFixture` adds the rest. The API can call `applyDemoFixture` the same
   way once it takes a fixture category. The plan is menu orders only, because a
   drop's free item has to be one of its own items. Drop specials are hidden
   from the everyday list (`showOnline: false`).
8. **Pictures for goods stores are drawings in `public/demo/`**, in the style of
   the dish drawings in `public/food/`. Nothing is uploaded, and nothing calls fal.
9. **One PR per phase, each from `main`.** Phase 2 starts once Phase 1 is
   merged, so the PRs never stack (#109 merged into its base, not main).

## The brief vs the code

- **1.5 was mostly there.** Open drops already rendered above everyday items,
  with "Order by …", a countdown and "Only N left" (5 or fewer).
- **1.1 for drops has nothing to pick.** A drop has exactly one handover window.
- **1.3:** drop windows already carried the date. The menu's "Pickup: …" is
  free text the seller types, so it can't take a day; the info card now adds
  "Next slot: Tomorrow · 12–2 pm" when slots are set.
- **2.3:** no code generates a default tagline. "X from Hyderabad" was typed in,
  or it's the type and city line under the store name. The nudge asks for a
  tagline when there is none.
- **2.4:** "Sound on — tap to enable" means sound is on but the browser needs a
  tap before it can play. It is not the off state.
- **2.5:** the prompt already shared one banner slot with the other banners on
  /orders (it also showed on /drops), and the permanent entries were Settings →
  Tell us what's hard and the Help guide. Now: /orders only, once per session,
  14 days.
- **2.1 on drops:** the prep sheet already merged gifts into the item's total
  (a gift is a line on the drop item); only the "(N free)" was missing.
- **2.6:** "Top" in the sticky bar already scrolled to the top (`#store-top`).
  Checked in Chromium (Android); mobile Safari not checked on a device.
- **3.1:** the hero mockup's ₹600 already adds up (₹320 + ₹280).
- **3.7:** `@axe-core/playwright` isn't installed; the contrast check adds it.

## Open decisions for the founder

**Lite plan pricing.** Lite ₹599 (50 orders) sits ₹50 under Starter ₹649
(unlimited), and its button says "Start 30 days free" although the trial runs
on Starter limits.
- Remove Lite: two plans, the trial is plainly Starter. The decoy goes with it.
- Reprice Lite to about ₹299: a real entry plan, and the anchor copy becomes
  "from ₹299/month". Needs new Razorpay plans and ids on Vercel in one deploy.
- Keep the prices, make the trial apply to whichever plan is picked: the most
  code (the trial is Starter limits everywhere) and the least clear.

**Regional languages for voice.** Voice offers English and Hindi; outreach
targets Telugu, Kannada and Marathi markets.
- Say "more languages coming" next to the voice picker and on the landing page.
- Turn one back on: Telugu, Kannada and Tamil are dormant behind Sarvam, with
  golden fixtures already in the repo; Marathi has neither. Telugu is the
  cheapest to revive (Hyderabad is the first market).
- Lead with tap ordering in those markets and keep voice for English and Hindi.
