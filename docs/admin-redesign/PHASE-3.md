# Admin redesign, Phase 3: order leak map

Branch `feat/admin-leak-map`, on top of Phases 1 and 2 (PRs #183 and #184, merged).

## What shipped

An **Order leak map** section on `/admin/metrics`, between the cards and the seller heartbeat:

- **Funnel table.** The storefront orders placed in the last 7 complete IST days (the same window as the
  cards), stage by stage:

  store view → cart → order placed → payment started → paid

  - Columns are where the buyer came from: All, Instagram, WhatsApp, Direct, Other.
  - The small figure under each count is its share of the stage above.
  - Cart reads "Not tracked" (decision D2).
- **Biggest leak.** One line above the table names the step that loses the most, for example "Biggest leak:
  Order placed → Payment started. 4 of 15 went no further."
- **Reconciliation.** The order count comes from the same `where` as the Instagram card
  (`storefrontOrdersWhere` in `lib/admin-metrics.ts`). The page shows a warning if the two ever differ, and a
  note says they match.
- **Unpaid orders.** Every order of the window that isn't paid, newest first (the newest 50 are listed, with
  the total count shown).
  - Each card shows store, bill number, amount, when it was placed (IST), source, how far it got, and a tag
    when it was cancelled or handed over without being marked paid.
  - Chips filter it: All unpaid / Didn't start paying / Started, not paid. The filter is a link
    (`?leak=not_started`), and it keeps the heartbeat's `?badge=` and vice versa.
- **Remind the seller on WhatsApp** (SUPER_ADMIN only, open orders only):
  - It is the same editable-message component as Nudge, opening `wa.me` to the seller's WhatsApp number (or
    sign-up phone).
  - The copy is in `content/admin-nudges/stalled-order.txt`.
  - It never messages a buyer: the leak map selects no buyer name, phone, address or UTR at all.
  - A plain ADMIN sees the funnel and the unpaid list without the button, and no contact is read.

### Tracking added

- **Store views.** A full page load of `/s/[slug]` by a buyer's browser bumps an Upstash counter in the
  background (`lib/store-views.ts`). There is no new endpoint and no Postgres write.
  - Not counted: link previews (WhatsApp, Instagram, Facebook fetchers), bots, headless browsers, prefetches,
    client-side refreshes, demo stores and the store's own signed-in staff.
  - Next.js strips its `RSC` header before the page sees it, so a refresh is told apart by the browser's
    `Sec-Fetch-Mode` (`navigate` only for a real page load). I found this in a browser test; it is now
    covered by a unit test.
- **WhatsApp as a source.** The seller's explicit WhatsApp share buttons now add `?src=wa` to the store link
  (`buildTaggedWhatsAppShareUrl`):
  - the board's "WhatsApp" item;
  - the drop page's WhatsApp button;
  - the wa.me fallback when a device has no share sheet.

  The device share sheet keeps the plain link, because it can hand the text to any app. The order routes
  accept `src: "ig" | "wa"`, and `orderChannel` stores `"whatsapp"`.
- **Other as a source.** Facebook's and Messenger's in-app browsers (user agent `FBAN` / `FBAV` / `FB_IAB`)
  are stored as `"facebook"` and shown under Other.

### Changed from the plan in DISCOVERY.md

**No `paymentStartedAt` column, so no migration.** "Payment started" is derived from what the payment routes
already write. That means no payment route changed. The funnel is a cohort of the orders placed in the window,
so it needs whether payment started, not when.

## Metric definitions

Orders are `Transaction` rows with `source = STOREFRONT`, `isSample = false`, on a store with
`isDemo = false`, placed (`createdAt`) in `[istDayStart(7), istDayStart(0))`. That is exactly the Instagram
card's set.

| Stage | Counted when |
|---|---|
| Store view | a counted page load (above) on an IST day in the window, from Upstash. Views aren't a cohort: they are counted by the day they happened |
| Cart | not tracked |
| Order placed | every order in the set |
| Payment started | `razorpayOrderId` set (Razorpay's window was opened; the id is written only by `/api/s/[slug]/orders/[token]/razorpay`), or `paymentClaimedAt` (buyer tapped "Payment done"), or `paymentRejectedAt` (seller answered "Not received" to a claim), or `paymentMethod = CASH` (pay on delivery), or paid |
| Paid | `paymentStatus` PAID or REFUNDED (it was paid), as of now |

Each stage is a subset of the one before, except views, which are a separate count.

The share under a count is that count ÷ the stage above, by column. Order placed gets a share of views only
when views were counted for the whole window.

**Store views status:**
- **Full**: counting began before the window started.
- **Partial**: counting began inside the window. The number is shown with "Counted since DD/MM/YYYY", and there
  is no view-to-order share.
- **Not tracked yet**: no view counted ever.
- **Not tracked: the view counter can't be read**: Upstash is unset or failing.

The start date is written by the first counted view (`SET NX funnel:v1:since`), so nobody has to edit it at
deploy.

**Source columns:**

| Column | `orderChannel` |
|---|---|
| Instagram | `instagram`: Instagram's in-app browser, or `?src=ig` (from 04/11/2026) |
| WhatsApp | `whatsapp`: `?src=wa` (from this release) |
| Direct | null: no tag and no known in-app browser, including WhatsApp and Instagram orders placed before their tag existed |
| Other | anything else; today only `facebook` |

Views use the same rules (`orderChannelFor` on the page's `src` and user agent).

**Biggest leak**: the step that loses the most orders: placed → started, started → paid, and view → placed
when views cover the whole window.

## Migrations

None. The `orderChannel` column comment in `schema.prisma` changed; comments produce no SQL.

## Upstash keys

| Key | Type | TTL | Holds |
|---|---|---|---|
| `funnel:v1:views:<YYYYMMDD>` (IST day) | hash, field `<vendorId>\|<source>` | 60 days | view counts |
| `funnel:v1:since` | string | none | ISO time of the first counted view |

One pipelined request (`HINCRBY`, `EXPIRE`, `SET NX`) per counted view, run in `waitUntil` so the buyer never
waits. One pipelined read (`GET` + 7 `HGETALL`) per admin page load. No PII.

## Helpers, scripts and files created

- `lib/order-funnel.ts` (pure):
  - `buildOrderFunnel`, `paymentStageOf`, `funnelSourceOf`, `isCountableStoreView`, `stepRate`,
    `parseStalledFilter`;
  - `FUNNEL_SOURCES`, `SOURCE_LABEL`, `STALLED_FILTERS`, `STALLED_LABEL`.
- `lib/order-funnel-server.ts`: `loadOrderFunnel`, `loadRemindTemplate`, `remindMessageFor`.
- `lib/store-views.ts`: `countStoreView`, `readStoreViews`, `viewsKey`.
- `lib/admin-template.ts`: `fillAdminTemplate`, the token filler now shared by Nudge (`fillNudgeTemplate`
  calls it) and Remind.
- `lib/admin-metrics.ts`: `storefrontOrdersWhere`, the one definition of "storefront orders in a window".
- `lib/order-channel.ts`: `WHATSAPP_SRC`, `ORDER_SRCS`, `withSrcTag`, `withWhatsAppTag`, `parseOrderSrc`. The
  `"whatsapp"` and `"facebook"` channels.
- `lib/drops-share.ts`: `buildTaggedWhatsAppShareUrl`.
- `components/admin/OrderLeakMap.tsx`.
- `content/admin-nudges/stalled-order.txt`, plus the README section for it.
- Tests:
  - new: `lib/__tests__/order-funnel.test.ts`, `lib/__tests__/store-views.test.ts`;
  - extended: `order-channel.test.ts`, `drops-share.test.ts`, `order-channel.db.test.ts`.
- Local tooling, in the session scratchpad, not committed:
  - `seed-leak.cjs`: a week of storefront orders on top of Phase 2's `seed-hb.cjs`;
  - `kv-mock.cjs`: a stand-in for the Upstash REST API on :8079;
  - `shot-leak.cjs`: the browser view-count check and screenshots; modes `super`, `admin`, `nokv`.

## Checks run

- Unit: 2,254 passed (full suite), including 14 funnel tests and 5 view-counter tests.
- DB (local Postgres): `order-channel.db`, `menu-orders.db` and `drops.db`, 25 passed, including the new
  `src=wa` → `whatsapp` and Facebook user agent → `facebook` case.
- E2E (chromium, local build and Postgres): storefront, menu orders, drops, orders board, public, UPI pay,
  paid claim and admin access, 52 passed.
- Typecheck, lint, `next build`, bundle budget: pass. The template is traced into the `/admin/metrics` bundle.
- **View counting in a real browser** (local build with the KV stand-in):
  - a page load with `?src=wa` counted one WhatsApp view;
  - an RSC-style fetch counted nothing;
  - a reload counted one;
  - a curl with WhatsApp's preview user agent counted nothing;
  - a Facebook user agent counted under Other.
- **Reconciliation** on the seeded week: 15 placed = 6 Instagram + 3 WhatsApp + 5 Direct + 1 Other, the same
  as the Instagram card's count. No warning.

## Screenshots

These are in the session scratchpad, from `next start` on a local Postgres. The seed is 15 storefront orders
over 02/11 to 08/11 across three stores, every source and every stage, plus 140 seeded views.

| File | Shows |
|---|---|
| `leak-375.png` / `leak-1280.png` | the section at 375 px and 1280 px (SUPER_ADMIN) |
| `leak-375-page.png` / `leak-1280-page.png` | the whole page |
| `leak-375-filter.png` | "Didn't start paying", with the heartbeat's At risk filter kept (`?badge=at_risk&leak=not_started`) |
| `leak-375-remind.png` | a Remind opened: `wa.me/919812345678?text=…`, decoded text equal to the textarea |
| `leak-375-admin.png` | a plain ADMIN: funnel and 8 unpaid orders, no Remind |
| `leak-375-nokv.png` | Upstash unreachable: "Not tracked: the view counter can't be read"; the biggest leak falls back to order stages |

At 375 px the page's `scrollWidth` is 375 in every state. The table is 317 px in a 317 px box, with short
source headings ("Insta", "WA") below `sm`; screen readers get the full names.

## Known gaps

- **Views are page loads, not people.** A buyer who opens the store three times is three views. Unique
  visitors would need a cookie or a fingerprint, which I didn't add.
- **Instagram's "Open in Chrome" counts twice.** On Android it is one view under Instagram, then one more
  under Direct unless the link was tagged. This is DISCOVERY.md B2.2, still open.
- **A day Upstash missed is a smaller number, not a gap.** There is no per-day "counter was down" marker.
- **"Payment started" misses UPI apps.** A buyer who opened a UPI app and paid, but never tapped "Payment
  done", shows as not started until the seller marks the order paid.
- **WhatsApp is under-counted.** Only shares through our WhatsApp buttons are tagged. A link the seller
  pastes into WhatsApp from Copy link, or a bio link forwarded from Instagram, counts as Direct.
- **Views are counted on `/s/[slug]` only.** The buyer's order page and account page don't count.
- **Remind isn't recorded.** As with Nudge, nothing logs that an admin sent it.
- **A failing KV slows the page.** When Upstash is set but failing, the admin page waits for the SDK's retries
  (a few seconds) before showing "Not tracked". The store page doesn't wait.

## Assumed, not verified

- Facebook's Android in-app browser user agent contains `FB_IAB` / `FBAV`, and Messenger's contains `FBAN`.
  These come from what I know of those apps, not from a captured device.
- Instagram's in-app browser sends `Sec-Fetch-Mode: navigate` on a page load, like the Chrome and Safari
  engines it is built on. If it sent nothing, views would still count (the rule only rejects a value other
  than `navigate`).
- Pay on delivery counts as "payment started" at placement, since the buyer has nothing more to do online.
- A REFUNDED order counts as paid, since it was paid.
