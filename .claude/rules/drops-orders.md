---
description: Drops (pre-orders), storefront order payments, the orders board, push alerts, menu orders, delivery, moved from CLAUDE.md
paths: ["lib/drops*.ts","lib/drop-*.ts","lib/menu-orders.ts","lib/menu-slots.ts","lib/delivery-*.ts","lib/rider-delivery.ts","lib/storefront-*.ts","lib/order-*.ts","lib/orders-banner.ts","lib/payment-proof.ts","lib/razorpay-*.ts","lib/push*.ts","lib/customer-auth.ts","app/api/drops/**","app/api/storefront-orders/**","app/api/s/**","app/api/d/**","app/api/webhooks/**","app/(vendor)/orders/**","app/(vendor)/drops/**","components/drops/**","components/storefront/**","components/push/**","public/sw.js"]
---

<!-- Generated from .cursor/rules/drops-orders.mdc by scripts/sync-agent-rules.mjs. Edit the source, then re-run. -->

# Drops (pre-orders)

Moved out of CLAUDE.md so it loads only when matching files are in play. CLAUDE.md keeps the cross-cutting rules.

## Drops (pre-orders)

A `Drop` is one batch a home kitchen sells ahead of time ("Saturday bakes, order by Fri 9 pm").
Core rules live in `lib/drops.ts` (read its header before touching it); buyers order on
`/s/[slug]`, the vendor builds drops on `/drops`, works their orders on `/orders` (the one orders
board, see "One orders board" below) and prints from `/drops/[id]/prep`.
`/drops` is a table per section (Upcoming, Past) whose actions are 44 px icon tiles (`dropRowActionClass`,
`components/drops/drop-row-action.tsx`), with a tiny word under each below `lg` and the row's next step filled.

**"Drop" is the code's word only. Sellers and buyers read "Pre-order"** ("New pre-order", the
"Pre-orders" tab, "Share this pre-order"). Wording only, like the store vocabulary: routes (`/drops`,
`/api/drops`, `?drop=`), the `Drop` model, API fields and error codes keep their names. New copy never
says "drop"; a buyer's own purchase stays an "order". The voice drop builder's system prompt still says
"drop" (changing it needs a golden run).

Three invariants, enforced in `lib/drops.ts` and nowhere else:

1. **No timers.** Cut-off is evaluated lazily on every read and order attempt
   (`effectiveDropStatus`). Nothing flips OPEN → CLOSED on a schedule — Neon must be able to
   sleep between orders. `SCHEDULED` and "past cut-off = CLOSED" are computed, never stored.
2. **No overselling.** `placeStorefrontOrder` takes `SELECT … FOR UPDATE` on the drop row, so
   orders for one drop serialise and the stock check can't race.
3. **Sold counts are derived, never stored.** Summed from `OrderItem` rows that still hold stock
   (`stockHoldingOrderWhere` / `orderHoldsStock` — keep the twins in lockstep). An unpaid UPI order
   holds stock for `PENDING_HOLD_MINUTES` (15) then silently stops counting; cancel frees stock.
   A buyer's "I've paid" claim (`paymentClaimedAt`, or a UTR) keeps the hold until the vendor answers.

A drop is created as `DRAFT` with no storefront check; opening it (`PATCH /api/drops/[id]/status`,
MANAGER) needs items, a future cut-off, a payment method and a published storefront, else 409.
Opening never publishes the store by itself: an OWNER confirms "Publish your store too?", which
sends `publishStorefront: true` and flips the setting in the same transaction as the status (a
MANAGER sending it gets 403 `owner_required`).

**A seller sees three steps: draft, taking orders, orders closed.** A new drop or a draft opens with
the form's "Open orders" button, which saves what is on screen first; a closed one has "Reopen orders"
in the Status panel. The cut-off closes a drop by itself and no tap follows it. `FROZEN` and `FULFILLED`
are older rows only: nothing moves a drop into them now, they stay read-only, and they keep the
`drop_frozen` / `drop_locked` rules. The form runs name and note, handover, items, cut-off; "More options"
holds the rest that has a default (later start, everyday menu), and a new drop takes its handover details from the store's last one
(`lastDropDefaults`), or for a first drop from its menu pickup / delivery answer (`storeHandoverDefaults`).

Money and plan rules:

- **Share this pre-order** sends the drop's own link, `/s/<slug>/preorder/<dropId>` (`preorderLinkPath`, `lib/drops-share.ts`), from the pre-orders table, the edit page and the board's Share menu: its page shows that drop only and its preview card draws only its items (`app/s/[slug]/preorder/[dropId]/share-card`). Which drop a link shows is `findFocusedDrop` (`lib/storefront-drop.ts`) and nowhere else.
- **Instagram story image:** `GET /api/drops/[id]/story-image` (CASHIER, compound `{ id, vendorId }`)
renders `lib/drop-story-image.tsx` at 1080×1920, inside Instagram's top/bottom overlay zones, with
`Cache-Control: private, no-store`. `InstagramStoryButton` fetches it on the first tap and shares the
file on the second (iOS drops the gesture across a fetch). Shared Satori parts: `lib/og-parts.tsx`.

`DailySummary` is credited when a storefront order is **paid** (`markOrderPaid`, idempotent via
  conditional `updateMany`), not when placed. Cancel of a paid order reverses it (`cancelOrder`).
  Pay-on-delivery is marked paid by the vendor's "Delivered · ₹X collected" tap.
- Storefront orders count toward `monthlyTxnCap` only once paid (`countBillableTxnThisMonth`).
- Online payment uses the **vendor's own Razorpay keys** (`lib/storefront-razorpay.ts`), secrets
  AES-256-GCM-encrypted with `PAYMENT_KEYS_ENCRYPTION_KEY` (`lib/secret-box.ts`). Never the platform
  `RAZORPAY_*` account — collecting on a vendor's behalf makes us an RBI payment aggregator.
  The other paths are UPI intent + the buyer's "I've paid" claim (vendor verifies) and pay on delivery.
  A store with Razorpay shows only "Pay online" on the order page: UPI and "Payment done?" stay hidden (`OnlinePayFlow`,
  `lib/storefront-direct-pay.ts`) until Razorpay fails, its window is closed or the seller answered "Not received", and
  never on `payment_processing`, so nobody is invited to pay twice. Closing Razorpay's window only leaves a quiet "Pay by UPI instead" link. Razorpay counts as a way to pay, so such a store needs no UPI ID (`payment.online`, `hasPaymentMethod`). Checkout sends a Razorpay order to the order page with `?pay=1`, which opens the window once and strips the param (`orderPagePath`).
- **A Razorpay store's seller hears about paid orders** (`lib/storefront-online-paid.ts`). Placing a UPI order there
  only moves the board signal; verify or the webhook, whichever wins `markOrderPaid`, sends the one "New paid order" push.
  On the board a new order the buyer hasn't paid (`isAwaitingOnlinePay`) is bucket `awaiting_online`: listed last under
  To accept, under its own heading, with no count, not in the summary, no chime, Cancel its only action (`checkOrderAction` agrees, so a stale board can't make it
  hold stock for good). Stock and prep sheets still count it. A claim or an expired hold puts it back on the normal
  path, so a direct UPI payment can still be marked paid. `BoardOrder.paidOnline` and the buyer's page say "Paid online"
  from `razorpayPaymentId`, and the buyer's progress drops Confirmed.
- **Connect Razorpay** (`lib/razorpay-oauth.ts`, plan in `docs/RAZORPAY_PARTNER_PLAN.md`): the same
  vendor-owned account reached by our Razorpay Technology Partner OAuth app instead of pasted keys
  (`RAZORPAY_OAUTH_CLIENT_ID` / `_SECRET` / `_MODE`). One method per store: connecting clears the keys,
  saving keys revokes OAuth. Tokens are encrypted beside the keys; `getVendorRazorpayCreds` returns
  either kind and renews the access token **on demand** under a `FOR UPDATE` row lock (refresh tokens
  rotate) — no timer. Verify trusts Razorpay's order record, not the Checkout signature, for OAuth
  stores. `/api/webhooks/razorpay-partner` (one app-level secret, HMAC before any DB read) matches
  orders within the body's `account_id`; both webhooks share `lib/storefront-razorpay-webhook.ts`.
  When Razorpay refuses to create a buyer's order (401 → access/keys, 400/403 → usually KYC not
  finished), the buyer gets `online_payment_unavailable` (pay by UPI) and `lib/razorpay-issue.ts`
  keeps the reason in Upstash (30-day TTL, fail-open) for Settings → Payments; the next accepted order,
  a reconnect, new keys or a disconnect clears it. Sellers without a Razorpay account sign up inside the
  Connect flow (Razorpay's co-branded onboarding), so there is no separate referral link. Connect starts
  from Settings → Payments or from setup's payment step and comes back to the one it started from: a fixed
  name (`?return=onboarding`, then a cookie scoped to the callback), never a URL (`lib/razorpay-connect.ts`).
- **"I've paid" never marks an order paid.** The buyer sees "Payment done?" with a screenshot picker
  (`PaidClaimForm`), or one "Payment done" button with no private Blob store. A direct UPI payment is
  invisible to us, so this signal stays: it is what keeps a drop's stock held. `POST /api/s/[slug]/orders/[token]/utr` records
  `Transaction.paymentClaimedAt` (UTR optional) → display state `PAYMENT_SUBMITTED`. The vendor answers
  on the board: "Yes, received" (`mark_paid` → `markOrderPaid`) or "Not received"
  (`reject_payment`: clears the claim and UTR, stamps `paymentRejectedAt`, per-order only). After a
  rejection the next claim needs a UTR (400 `reference_required`), so a hold can't be renewed by tapping.
- **Payment screenshot** (`lib/payment-proof.ts`): with the claim, the buyer may attach a screenshot
  (`POST /api/s/[slug]/orders/[token]/payment-proof`, multipart, only on an order that already has a
  claim, so it never creates or renews a hold). It is PII (name, UPI ID, UTR): a **separate private**
  Blob store (`PAYMENT_PROOF_BLOB_READ_WRITE_TOKEN`; unset → no field), never the public one. Staff
  view it through `GET /api/storefront-orders/[orderId]/payment-proof` (CASHIER, compound scope,
  `private, no-store`); boards and pages get `hasPaymentProof` only, never the URL. mark_paid,
  reject_payment and cancel clear `Transaction.paymentProofUrl` and delete the blob. Evidence, not proof:
  it never marks an order paid.
- **Paid means confirmed.** `markOrderPaid` also moves a `PLACED` order to `CONFIRMED` (same txn), on
  every path — seller tap, bulk, Razorpay webhook / verify, cash at the door. So a claimed order's
  card asks "Did ₹X reach your UPI app?" with "Yes, received" / "Not received" and no separate Accept
  (`availableOrderActions`); an unclaimed one keeps "Accept order" for accepting before the money arrives.

Buyer accounts are **not** NextAuth: `Customer` + passwordless email magic link
(`lib/customer-auth.ts`), tokens and sessions stored as SHA-256 hashes only, session in the
httpOnly `awz_cust` cookie. A buyer session never touches staff RBAC or widens a vendor `select`.

**One orders board.** `/orders` lists every storefront order — menu orders and all drops' orders —
in one list (`loadOrdersBoard` in `lib/drops-board-server.ts`: the last 3 IST days, older orders
still open, and every order of a drop whose handover window ended within those 3 days).
`BoardOrder.dropId` says which kind an order is. The "Show orders from" picker narrows the board
to menu orders or one drop (then its Share and "⋯" menus offer that drop's sharing, Edit and Prep sheet);
with a single source there is no picker. `/orders?drop=<id>` opens it on a drop and keeps a past drop on
the board; `/drops/[id]` only redirects there. **Don't add a second orders page.** Actions still
go to the order's own route family (`orderActionBase` in `lib/drops-board.ts`), so each keeps its
compound scope; the frozen rule is per order (`isDropFrozen` on its drop).

**Board layout** (`components/drops/orders/`): at most one banner above the board (`OrdersBannerSlot`, rules in
`lib/orders-banner.ts`): FSSAI reminder, then the one-time store polish nudge (published stores: test-named items, else no tagline;
`storePolishNudge`, "Got it" hides that reason for good), then install, then the owner survey, then "Earn free months"
(`shouldAskToRefer`); "Not now" lasts 7 days per device (the survey: 14 days, and once per browser session).
Billing notices and a checklist with open steps sit outside the slot. The header has one Share menu and one "⋯"
menu (`BoardMenus.tsx`). In menu scope the status pill sets `acceptMenuOrders` for an OWNER through `PATCH
/api/vendor`; it does not touch drops. Refresh, Sound and phone alerts are in the live sync bar at the bottom.

**Stages** (`boardBucket` in `lib/drops-board.ts`): the board's tabs are named after the seller's next job
(`boardFilterLabel`): To accept → To make / To pack (`toMakeTab` in the store vocabulary) → To hand over → Done; the ids
stay `new` / `preparing` / `ready` / `done`. To accept = not accepted, or a buyer's claim unanswered; To make = accepted;
To hand over = `Transaction.readyAt` ("Mark ready", pickups) or `outForDeliveryAt` ("Mark out for delivery"); Done =
handed over, cancelled, expired. Inside a tab the list is grouped (`boardSections`): To accept ends with "Waiting for
online payment" (`awaiting_online`, outside the count, so the count matches the cards above it), To hand over splits into
Waiting for pickup / Ready to send / On the way, and Done keeps "Cancelled or not paid in time" apart. A heading shows once
a tab has two groups, and always on those two that aren't the tab's job; search results stay one list. An open card
that still has a step to take shows a progress row (`orderProgressSteps`: Accepted · Ready · Picked up, or Accepted · On
the way · Delivered), words plus icons, payment never a step. Payment is never a
stage. Every card says two things, in words: its status line (`orderStatusLine`: "Waiting for you to accept",
"Check payment", "Being made" / "Being packed" by `storeKind`, "Ready for pickup", "On the way with <rider>", "Picked up" /
"Delivered", "Cancelled", "Not paid in time"), first on the card open or folded, and a payment badge (`paymentBadge`,
money only, none on a cancelled, lapsed or awaiting-online order); a handed-over order still unpaid is Done with
"Payment due". Buttons are verbs ("Mark paid", "Mark picked up") so none reads like a status, and the fixes say "Undo …". `readyAt` is a stamp like `outForDeliveryAt`, not a `FulfilmentStatus` (the order stays CONFIRMED);
`mark_ready` sets it, `unready` ("Undo ready") clears both stamps. Each card has one big button, its stage's
next step (`primaryOrderAction`: Accept order → Mark ready / Mark out for delivery → Mark picked up / Mark delivered;
Mark delivered first once the buyer says it arrived); everything else is in the card's ⋯ menu. Search covers every stage. The
summary is one line: Paid · To collect, plus "N payments to check" when a claim waits.

**Fix status** (mistake fixes, per order only, never bulk or the big button): the card's ⋯ menu lists
`fixStatusActions()` (`lib/drops-board.ts`, built on `availableOrderActions`), each behind an in-app confirm:
`unready`, `undeliver`, `mark_unpaid` ("Undo paid": `markOrderUnpaid` reverses exactly what `markOrderPaid`
booked, PAID → PENDING, `paidAt`, DailySummary on the `paidAt` day; the PLACED → CONFIRMED step stays) and
`uncancel` ("Reopen order": `reopenCancelledOrder`, not on a frozen drop). Neither ever touches an order Razorpay paid
(`razorpayPaymentId`, 409 `paid_online`). Reopening holds stock again, so it takes placement's locks in placement's
order (drop row, tracked items, sizes) and refuses `sold_out` (drop) / `out_of_stock` (menu). A paid order comes back
exactly (REFUNDED → PAID, revenue re-credited); an unpaid one comes back CONFIRMED (PLACED vs CONFIRMED isn't stored).

Orders board freshness: order placement and board actions bump one per-vendor Upstash counter
(`bumpOrderSignal` in `lib/drops-signal.ts`, fire-and-forget). Instant alerts come from Web Push;
board polling is only a fallback, so the board polls every **6 min** (`BOARD_POLL_MS`), only while
visible and only while a buyer could order (`boardPollKind`: "order from menu" on, or a drop open
or about to open), refetching from Postgres only when the counter moves. Keep it above Neon's
idle timeout — each tick's session check reads Postgres.

**Web Push alerts** (`lib/push.ts`): new storefront orders (on a Razorpay store, once paid) and submitted UPI references push to the
vendor's opted-in staff devices (`PushSubscription`, one row per device). Event-driven only — never
add a timer. `notifyVendorInBackground` wraps the send in `waitUntil` so it never blocks a buyer.
Payloads carry bill number, amount and item count only — **no buyer name, phone or address** (lock
screens are public). 404/410 from the push service deletes the row. A new device's endpoint must be on a browser push service
(`isPushServiceEndpoint`, `lib/push-devices.ts`), since our server POSTs to it. Feature-gated on
`NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`. `public/sw.js`, the manifest,
`offline.html` and the icons are excluded from middleware; iPhones need the site added to the Home Screen.

**Spoken new-order alert** (`lib/order-voice.ts`): on each push `public/sw.js` also posts
`{ type: "awz-push", tag }` to open pages. `OrderVoiceAlerts` (vendor layout) says "New order received
from <first name>" via `speechSynthesis` when Sound is on for the device (one localStorage choice,
**on by default**, shared by the sync bar's Sound button and Settings → Notifications), then fires
`PUSH_ARRIVED_EVENT` so an open board refetches at once. **The name never goes in the push payload**:
the page reads it from `GET /api/storefront-orders/announce?bill=` (CASHIER, `{ vendorId, billNumber }`,
returns the first name only) and gives it only to an on-device voice (`localService`); otherwise it
says "customer". Web Locks keep several tabs from speaking together. Listener only, no timer. It needs
an open page: a locked phone gets the notification without speech.

**Order from menu** (`lib/menu-orders.ts`, opt-in `VendorSettings.acceptMenuOrders`): buyers order
everyday `MenuItem`s with no drop — same STOREFRONT transaction with `dropId = null`, same payment
paths and plan-cap rule, but no cut-off, no stock caps and no row lock (only `isAvailable` items).
Fulfilment/fee/pickup note come from `menuFulfilmentMode` / `menuDeliveryFeePaise` /
`menuPickupNote`. Buyer route `POST /api/s/[slug]/menu-orders`; the vendor sees them on `/orders`
beside drop orders (`GET /api/storefront-orders` returns both; `PATCH` / `bulk` under it act on
menu orders only), sharing order actions with drops via `lib/storefront-order-actions.ts`.
Menu ordering has no cut-off to stop the board polling, so it polls every 6 min — keep it above
Neon's idle timeout.

**When and where** (`lib/menu-slots.ts`, `lib/delivery-address.ts`): a store can set weekly slots for menu
orders (`VendorSettings.menuSlots`, Settings → Online orders → Pickup and delivery times). With slots set,
checkout requires one and `placeMenuOrder` re-derives it from the rules (`slot_required` / `slot_unavailable`),
storing `fulfilAt` + `fulfilUntil`; the next 7 days, nothing starting within 60 min. Drop orders use the drop's
one window. A delivery address is a line + locality (required at checkout, optional on the wire so an old page
still orders), landmark and pincode: `deliveryAddress` keeps the whole address as one text
(`composeDeliveryAddress`), the parts sit beside it on `Transaction` and `Customer`. A store can also list where it delivers
(`VendorSettings.deliveryAreas`, `lib/delivery-areas.ts`, Settings → Online orders → Delivery areas: localities, each with an
optional fee replacing the drop's or menu's): with areas set, checkout offers the list instead of a free-text locality, both
order paths refuse any other (`outside_delivery_area`) and charge that area's fee, and the store page says "Free delivery in …".
No radius: orders carry no coordinates. Every window a page shows
goes through `formatWindowWithDay` ("Today · 5–9 pm"); text read later (share, story, WhatsApp) keeps the date.
Every drop state reads with its reason through `dropStateLabel` (`lib/drop-state.ts`), never a bare "Orders closed".

**Delivery handoff** (`lib/delivery-handoff.ts`, `lib/delivery-riders.ts`): a delivery order's card has
"Copy for rider" and, for each rider saved in Settings → Online orders (`VendorSettings.deliveryRiders`,
≤ 5 `{ name, phone }`, OWNER via `PATCH /api/vendor`), "Send to <name>" — a `wa.me` link to the rider
with the handoff text (buyer name, phone, address, items, cash to collect). The seller's tap sends it;
nothing goes through the server. Opening it also runs the `dispatch` action, as does the "Out for
delivery" button: `outForDeliveryAt` (+ `riderName` snapshot) is a **stamp, not a `FulfilmentStatus`**
— the order stays `CONFIRMED`, so stock, payment, buckets and bulk actions are untouched. The buyer's
page reads "On the way" and never shows the rider's name.
The handoff text ends with the rider's own link, `/d/<Transaction.riderToken>` (`lib/rider-delivery.ts`):
192-bit, minted for every DELIVERY order at placement (or on confirm / dispatch for older ones), and
**separate from `orderToken`**, so the buyer's link can't mark an order delivered. The page shows the
door details (name, phone, address, items, cash to collect) only while the order is live, and one
"Delivered" button that runs the board's own `deliver` action (cash → paid, DailySummary once); once
delivered or cancelled it shows no buyer details. The buyer's "I've received my order"
(`POST /api/s/[slug]/orders/[token]/received`) stamps `buyerReceivedAt`; a paid order is also marked
delivered, an unpaid one waits for the seller — a buyer's tap never books cash. Both push to the
seller (bill number only) and bump the board signal.

**Order again** (`lib/order-again.ts`, `lib/order-again-server.ts`): once an order is over (handed over,
cancelled, lapsed), the buyer's order page and account page offer it. It fills the normal saved cart on
the device (everyday menu or the open drop that can take the most of the order, matched by
`OrderItem.menuItemId`) and opens the store; checkout re-checks everything. Read on page render only.

**Messages to the buyer** (`buyerUpdateMessage` in `lib/drops-board.ts`): the order card's WhatsApp button
pre-fills text for the order's status with the buyer's order link, plus "Ready for pickup" on a confirmed
pickup. A `wa.me` link the seller sends from their own WhatsApp; it stamps nothing and sends nothing from us.

**Where orders come from** (`lib/order-channel.ts`): `Transaction.orderChannel` is `"instagram"` when the order was
placed in Instagram's in-app browser (user agent) or from a store page opened through a `?src=ig` link (posted as
`src`), `"whatsapp"` from a `?src=wa` link, `"facebook"` in Facebook's or Messenger's in-app browser, else null. Only
links the seller is told to put on Instagram carry `ig` (the setup card's bio link, the story button's Link sticker),
and only wa.me shares carry `wa` (`buildTaggedWhatsAppShareUrl`; the device share sheet keeps the plain link). The
general Copy link stays clean. The user agent is never stored. `/admin/metrics` counts them in the Instagram card
and the order leak map (`lib/order-funnel.ts`), whose store views are an Upstash counter bumped from the `/s/[slug]`
render (`lib/store-views.ts`: full page loads by a buyer's browser only, never demo stores or the store's staff,
fire-and-forget, no PII, no Postgres write).

**Bulk order actions** (`lib/order-bulk.ts` client-safe, `lib/storefront-order-bulk.ts` server): the
board selects orders and applies confirm (Accept) / mark_paid / mark_ready / deliver via `POST /api/drops/[id]/orders/bulk`
and `POST /api/storefront-orders/bulk` (`{ orderIds: 1..50 unique, action }`, CASHIER); a selection
that mixes sources is split per route on the client (`groupIdsByDrop`). One
transaction per order, run in sequence, each through `applyStorefrontOrderAction` with the
single-order compound scope, so one stale order never rolls back the rest. Response
`{ data: { succeeded, failed: [{ id, error }], orders } }`; unknown and cross-tenant ids are both
`not_found`. Cancel and the Fix status actions stay per-order. Card buttons and bulk eligibility share
`availableOrderActions()` (`lib/drops-board.ts`) — keep them on that one function.

DB-backed drops tests are opt-in: `npm run test:drops:db` (needs a throwaway `DATABASE_URL`).
