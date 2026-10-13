# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

AwaazOS is multi-tenant pre-ordering and billing for Instagram-based cloud kitchens (ICP in
`docs/ICP.md`): storefront link in bio → Drops with a cut-off → UPI → orders board and prep sheet.
It began as a voice-first counter POS (vendor speaks "do samosa aur ek chai" → Claude parses it
against the menu → UPI QR → WhatsApp receipt); that path still ships.

## Commands

```bash
npm run dev            # Next.js on :3000
npm run worker         # BullMQ workers (separate terminal; needs REDIS_URL)
npm run typecheck      # tsc --noEmit
npm run lint           # eslint . (ESLint 9 flat config, eslint.config.mjs)
npm test               # vitest run
npm run build          # next build
npm run e2e            # playwright (auto-starts dev server unless BASE_URL is set)
npm run perf:budget    # after a build: first-load JS per route vs perf-budget.json (CI gate)

npx prisma db push     # apply schema to Neon (no migration files and no seed script in this repo)
npm run db:studio

# Single test / single case
npx vitest run lib/__tests__/currency.test.ts
npx vitest run -t "formatINR"
npx playwright test e2e/public.spec.ts --project=chromium
```

Vitest only picks up `**/*.test.ts` (node environment, `@/` alias → repo root).

### E2E writes real rows — never point it at production

The suite registers vendors, creates menu items and rings up sales. `.env` is what
both Prisma and Next read, so running `npm run e2e` with production `DATABASE_URL`
in it seeds junk into the live database. Use a throwaway Postgres, same image CI uses:

```bash
docker run -d --name awaazos-e2e -p 5433:5432 -e POSTGRES_USER=ci -e POSTGRES_PASSWORD=ci -e POSTGRES_DB=awaazos postgres:15-alpine

export DATABASE_URL="postgresql://ci:ci@localhost:5433/awaazos?schema=public"
export DIRECT_URL="$DATABASE_URL"
npx prisma db push --skip-generate
npx playwright test --project=chromium

docker rm -f awaazos-e2e     # when done
```

Exported vars win: Next does not overwrite an env var that is already set.
`BASE_URL=https://…` runs the read-only specs against a deployment, but the
vendor-creating specs will write to whatever database that deployment uses.

### Golden tests (LLM/ASR regression harness)

Live runs cost real money. The `live.test.ts` files match the Vitest glob, so `npm test` collects
them, but each live suite skips itself unless its `*_LIVE=1` flag is set. Offline validators run
in CI as part of `npm test`.

```bash
npm run test:golden:validate        # offline: fixture shape + menu refs
npm run test:golden:stt:validate    # offline

GOLDEN_PARSE_ORDER_LIVE=1 npm run test:golden      # real Claude run
GOLDEN_STT_LIVE=1 npm run test:golden:stt          # real ASR run (needs audio/ clips)
```

Windows PowerShell: `$env:GOLDEN_PARSE_ORDER_LIVE="1"; npm run test:golden`.
Failures dump diffs to `tests/golden/*/.last-run/<provider>/<id>.diff.json`.
See `tests/golden/parse-order/README.md` for the rule on qualifying a new provider
(pass rate within ~5% of Claude Haiku before it becomes a fallback).

### Provider smoke tests

`npm run smoke:sarvam | smoke:openai | smoke:groq | smoke:whisper` — one-shot
round-trips against a live STT provider, for checking credentials/connectivity.

## Deploy topology (three hosts, not one)

| Runs where | What |
| --- | --- |
| **Vercel** | Next.js App Router, all `/api/*` (Node runtime), edge middleware |
| **Fly.io (BOM)** | BullMQ workers — `workers/` — plus `services/whisper-stt` (optional Python ASR) |
| **Neon** | Postgres. `DATABASE_URL` = pooled, `DIRECT_URL` = direct (`prisma db push`) |

Vercel deploys through the Git integration: `vercel.json`'s `ignoreCommand` skips every non-production
build, so preview deployments are off and a push to `main` is a production deploy. The Fly worker app
named in `fly.toml` (`awaazos-workers`) does not currently exist (TODO.md 1.1), so nothing drains the
BullMQ queues in production.

**Two Redis surfaces, not interchangeable — the single easiest thing to get wrong:**

- `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` → `lib/kv.ts` (@upstash/redis over HTTP).
  Used on Vercel for rate limiting, idempotency, circuit breakers, AI usage caps, `/api/ready`.
  Serverless can't hold TCP, so anything running in an API route uses this.
- `REDIS_URL` (TCP `rediss://`) → `lib/queues.ts` (ioredis + BullMQ), the only TCP Redis client.
  Workers on Fly consume; API routes on Vercel enqueue (`voice-parse-log`, admin retention runs,
  the dormant Gupshup receipt path). Without it on Vercel those enqueues fail; voice telemetry is
  dropped silently.
  On Vercel it must be a **public** endpoint — Fly `*.internal` hostnames are unreachable from Vercel.

`.vercelignore` excludes `workers/` from the Vercel build.

## Architecture

### Voice pipeline: STT and NLU are deliberately separate (see ARCHITECTURE.md §3 ADR)

```
mic → STT (ASR only, no LLM) → transcript → /api/ai/parse-order (Claude) → cart
```

- **Never send audio to Anthropic. Never use Claude for transcription.** Only `transcript` + `menu`
  enter the LLM prompt.
- `POST /api/ai/transcribe` runs a per-language provider cascade, each hop guarded by its own
  circuit breaker (`lib/circuit-breaker.ts`, Upstash-backed) and minute quota (`lib/ai-usage-guard.ts`):
  - `te/kn/ta` → Sarvam → Groq → Whisper
  - `en/hi` → OpenAI → Groq → Whisper
  - OpenAI, Groq and Whisper are skipped when not configured (Sarvam is always tried for
    `te/kn/ta`). Whisper only joins when `WHISPER_STT_URL` is set **and** `WHISPER_STT_SECRET` is
    at least 16 characters — a shorter secret silently drops it. Sarvam defaults to `saaras:v3`.
  - The route is plan-gated (`requirePlan(..., Plan.STARTER)`) for every language.
  - **`te/kn/ta` are dormant.** The picker (`VOICE_LANGUAGES` in `lib/constants.ts`) offers only
    `en-IN` and `hi-IN`; the Sarvam code path and golden fixtures are kept, reachable only through
    legacy `VendorSettings.voiceLang` rows or a direct `PATCH /api/vendor` (which still accepts
    `SUPPORTED_VOICE_LANGS`).
  - Cascade exhaustion returns **200** with `{ error: "all_providers_failed", fallback: "quickadd" }`
    — the client falls back to tap input, it is not an error state for the vendor.
  - `en/hi` normally never reach this route at all: the browser does Web Speech locally, unless
    `NEXT_PUBLIC_VOICE_FALLBACK_ENABLED=true` routes them through the server cascade.
  - Provider ids are one list, `STT_SOURCES` in `lib/stt-source.ts`.
- `POST /api/ai/parse-order` runs two-tier Claude with forced `add_items` tool-use
  (`lib/anthropic.ts`). Haiku 4.5 primary → escalates to Sonnet 4.5 per `shouldEscalate()`
  (empty cart on a >3-word transcript, empty cart with no unmatched, or low confidence + unmatched)
  and on any Haiku throw. The menu JSON block carries `cache_control: ephemeral` and is emitted by
  `stableMenuJson()` — **key ordering and sort order are load-bearing for the prompt cache; don't
  reorder them casually.**
- Model output is not trusted directly: `alignParsedItemsToMenu()` re-anchors ids/prices to real
  menu rows and `rescueMatchFromTranscript()` (`lib/parse-order-align.ts`) does a last-ditch
  string match when the model returns nothing.
- Telemetry is fire-and-forget: enqueue `voice-parse-log` on BullMQ, never await, swallow enqueue
  failures. The cashier never waits on logging.

**Voice drop builder** — `POST /api/ai/parse-drop` (`lib/parse-drop.ts`, MANAGER) turns a cook's
spoken plan ("aaj ke liye 20 ragi laddu 150 rupaye, pickup shaam 6 se 8, order 4 baje tak") into a
**draft** `DropDraft` (`lib/parse-drop-types.ts`, client-safe) for the drop form; it saves nothing.
Same shape as parse-order: forced `build_drop` tool, Haiku → Sonnet (`shouldEscalateDrop()`: Haiku
throws, empty items on a >3-word transcript, or ≥ half the items without a valid menu id), menu block
from `stableMenuJson()` with `cache_control`, and today's IST date/time only in the uncached
transcript block. `postProcessDropDraft()` never trusts the model: relative days resolve from server
time in IST, times are re-validated, items re-anchor to this vendor's menu (unknown ids → name match
via `rescueMatchFromTranscript()`, else `unmatched`), rupees go through `rupeesToPaise`, counts clamp,
and anything `dropUpsertSchema` would reject becomes a `warnings` entry, not an error. Missing
`ANTHROPIC_API_KEY` → 503 `{ error: "voice_unavailable", fallback: "form" }`. No `voice-parse-log`
(the log has no kind column). Golden set `tests/golden/parse-drop/`:
`npm run test:golden:drop:validate` offline, `GOLDEN_PARSE_DROP_LIVE=1 npm run test:golden:drop` live.

**Voice menu builder** — `POST /api/ai/parse-menu` (`lib/parse-menu.ts`, CASHIER) turns a spoken dish
list ("masala chai 15, samosa 20, vada pav 25 — snacks mein; mango lassi 60, drinks") into a **draft**
`MenuDraft` (`lib/parse-menu-types.ts`, client-safe); it saves nothing. Forced `add_menu_items` tool,
Haiku → Sonnet (`shouldEscalateMenu()`: Haiku throws, empty items on a >3-word transcript, or most
dishes priceless although the transcript has numbers); cached block = `stableMenuJson()` of the
vendor's WHOLE menu (unavailable items too) + its sorted category list. `postProcessMenuDraft()`
never trusts the model: existing items match by exact name/alias, then a model id only if it is this
vendor's and ≥ 0.6 similar, then server fuzzy ≥ 0.85 with a clear winner (else a new dish);
`rupeesToPaise`, prices ≤ 0 or > ₹1,00,000 dropped (`priceSpoken: false`, new rows carry 0 — the UI
must ask), repeats merged (last price wins), 50-row cap, categories snapped to existing spellings.
The UI saves confirmed rows with `POST /api/menu/bulk` (one `$transaction`: price-only updates with
compound `where { id, vendorId }`, foreign ids → `skipped`; creates via `lib/menu-create.ts`, the same
slug/alias/sortOrder path as `POST /api/menu`). Golden set `tests/golden/parse-menu/`:
`npm run test:golden:menu:validate` offline, `GOLDEN_PARSE_MENU_LIVE=1 npm run test:golden:menu` live.

### Money is integer paise, everywhere

`Int` in Prisma, `number` in TS. `parseFloat`, `toFixed`, `Decimal`, and `Math.round` on prices are
banned. Use `lib/currency.ts` (`rupeesToPaise`, `paiseToRupees`, `formatINR`, `sumPaise`).
Tax uses basis points: `Math.floor(subtotalPaise * taxBps / 10_000)`.

**The one exception in the entire codebase** is `lib/upi.ts`, where the UPI spec requires decimal
rupees in the `am=` deep-link parameter. A stray `toFixed` anywhere else is a bug:

```bash
rg -l "toFixed" --glob '!lib/upi.ts' --glob '!*.md' app/ components/ lib/ workers/ hooks/   # must be empty
```

### Tenant isolation

`Vendor.id` is the tenant id; a `User` reaches vendors through `StaffMember`. Every protected
handler starts with `requireVendorRole(minRole, vendorIdOrSlug?, req?)` (`lib/rbac.ts`), which
resolves the active vendor as `?vendor=` → `awz_vendor` cookie → oldest membership. When it returns
a non-null `setVendorCookie`, the route should set that cookie on the response.

Every Prisma `where` touching tenant data must include `vendorId` — **use a compound `where` on
mutations** (`where: { id, vendorId: vendor.id }`), never a post-fetch ownership check.
Cross-tenant misses return **404, not 403** — don't leak existence.

The exception to "every protected handler starts with `requireVendorRole`" is the **public
storefront surface** — unauthenticated, and no longer read-only (buyers place pre-orders):

| Surface | What |
| --- | --- |
| `/s/[slug]` | Menu + open drops + checkout |
| `/s/[slug]/o/[token]` | Buyer's order page (status, UPI pay, "I've paid" claim) |
| `/s/[slug]/account` | Signed-in buyer's own orders/profile |
| `/r/[token]` | Customer receipt page (see "Receipt module"; not gated on `publishStorefront`) |
| `/api/s/**` | Order placement, UTR submit, vendor-Razorpay start/verify, buyer magic-link auth |
| `/api/webhooks/razorpay-orders/[vendorId]` | Per-vendor Razorpay webhook (vendor's own secret) |

Rules every one of them follows:

- Gated on `VendorSettings.publishStorefront` (default `false`); not opted in → **404, not 403**.
- Prisma `select` is a hand-written allowlist. `Vendor.phone` / `Vendor.email` never appear.
- Store banner and logo (`Vendor.bannerUrl` / `logoUrl`): OWNER-only `POST`/`DELETE /api/vendor/banner`
  and `/api/vendor/logo` (`lib/store-image.ts`), edited in Settings → Online store. Upload rules (4 MB,
  JPEG/PNG/WebP, validate before Blob) are shared with menu photos in `lib/blob-image.ts`; the browser
  shrinks photos first (`lib/image-downscale.ts`). No Blob token → 503. The banner is decorative
  (`alt=""`); without one the header keeps its theme gradient.
- The vendor's WhatsApp number reaches a public page only through `buyerWhatsappNumber()`
  (`lib/storefront-order.ts`): `VendorSettings.whatsappNumber`, and only once the vendor opts in
  with `acceptWhatsappOrders` (default `false`; Settings → Online orders). A saved number is not
  consent — onboarding pre-fills it from the sign-up phone.
- Order pages are keyed on `Transaction.orderToken` alone (192-bit random, `generateOrderToken()`),
  always looked up together with the slug's `vendorId`. Never expose or accept a transaction `id`.
- Every write is IP rate-limited (`makeLimiter` in `lib/ratelimit.ts`; buyer login also per-email).
- No buyer PII (phone, name, address, UTR, email) in logs, Sentry or error bodies.
- The order webhook can't verify HMAC before *any* DB read — the secret is per vendor — so it
  reads exactly one column (the encrypted webhook secret) first, and nothing else until verified.
  Unknown vendor and bad signature are indistinguishable (both 400).

Two role axes: platform `UserRole` (`USER < ADMIN < SUPER_ADMIN`) and per-tenant `StaffRole`
(`CASHIER < MANAGER < OWNER`). Plan gates are separate again: `requirePlan(vendor, Plan.STARTER)`
throws `PlanGateError` (402) carrying `{ required, current }` so the UI can render an upgrade CTA.
Limits live in `PLAN_LIMITS` in `lib/constants.ts`.

### Billing: trial, lock and platform subscriptions

Full design in `docs/RAZORPAY_SUBSCRIPTIONS_PLAN.md`. One offer is sold: a `TRIAL_DAYS` (30) day
free trial with STARTER limits, then STARTER monthly or yearly. Prices exclude 18% GST
(`GST_BPS`); the Razorpay plan amount is base + GST (`subscriptionChargePaise`).

`billingAccess(vendor)` in `lib/plan.ts` derives one of four states from `Vendor.plan`,
`planExpiresAt` and `trialEndsAt` on every read. **No timers** — nothing is written when a date
passes, so Neon can sleep.

| State | When | Effect |
| --- | --- | --- |
| `paid` | paid plan, not past `planExpiresAt` + 3-day grace | that plan's limits |
| `trial` | not paid, before `trialEndsAt` (set at sign-up) | STARTER limits |
| `locked` | not paid, `trialEndsAt` passed | no new sales, storefront orders or AI calls |
| `free` | not paid, `trialEndsAt` null (signed up before the trial) | FREE limits, never locked |

- `requireVendorRole` returns `access` and the effective `vendor.plan`. Anything that makes a new
  sale, takes a new order or spends on AI calls `requireActiveBilling(ctx)` → 402
  `{ error: "billing_locked" }`. **Never call it on reads, settings, billing, CSV export, or
  actions that finish an existing order** — a locked vendor keeps access to their records.
- Code that loads a vendor without `requireVendorRole` (storefront routes) must select
  `planExpiresAt` **and** `trialEndsAt`; leaving `trialEndsAt` out treats a trial vendor as FREE.
  Buyers of a locked vendor get `orders_paused` (409) and are never told why.
- A `deferred` offline sale rung up before the lock (`clientCreatedAt < access.since`) still syncs.
- The subscription webhook (`/api/webhooks/razorpay`) is idempotent through the `SubscriptionEvent`
  ledger (unique `x-razorpay-event-id`). Transitions are the pure `applySubscriptionEvent`
  (`lib/subscription.ts`): `planExpiresAt` comes from Razorpay's `current_end`, only moves forward,
  and the webhook never downgrades a paying vendor — expiry is lazy.
- Subscribing happens on the billing page with Razorpay Checkout in place
  (`components/billing/BillingManageClient.tsx`, loader shared with the storefront in
  `lib/razorpay-checkout.ts`): `create-subscription` → Checkout → `POST
  /api/razorpay/verify-subscription`. Verify never trusts the browser: it checks
  `HMAC(payment_id|subscription_id)` with the platform key secret, requires the subscription to be
  the one on file for the signed-in vendor (else 404), then reads its state from Razorpay.
- **One write path:** the webhook and verify both go through `recordSubscriptionEvent`
  (`lib/subscription-store.ts`), so whichever lands second changes nothing. Don't write
  `plan` / `planExpiresAt` anywhere else.
- Marketing copy (`lib/plan-copy.ts`) and the legal pages read the trial length and prices from
  the constants. FREE is not marketed.
- E2E: new vendors are on the trial. Specs that need another state set it in the database with
  `e2e/helpers/billing-db.ts` (local databases only).

### Transaction write path

`POST /api/transactions` recomputes subtotal/total server-side and rejects mismatches with 400, then
does everything in one `prisma.$transaction`: `billSequence.upsert` (atomic per-`(vendorId, date)`
increment producing `AWZ-YYYYMMDD-NNNN`) → `transaction.create` with nested `orderItems` →
`dailySummary.upsert` → `receipt.create`. WhatsApp enqueue happens **after** commit and its failures
are logged and swallowed — Redis being down must never block a sale.

**Receipts go out via wa.me, not Gupshup.** The POS "Send on WhatsApp" and the transactions
"Resend" fetch text from `GET /api/receipts/message` and open a `wa.me` link
(`receiptWhatsappUrl()` in `lib/whatsapp-message.ts`) in the vendor's own WhatsApp. The Gupshup
path — `lib/whatsapp.ts`, `workers/receipt.worker.ts`, `POST /api/receipts/send`, and the
post-sale enqueue above (only when a `customerPhone` is posted on a plan with `whatsapp: true`) —
is kept but unused by the UI. See TODO.md 1.1 before reviving it.

**Receipt module.** One `ReceiptView` (`lib/receipt.ts`, pure and client-safe) per bill, built by
`lib/receipt-data.ts` from the `RECEIPT_TX_SELECT` allowlist (no customer phone/name/address/UTR,
no vendor phone/email). It is rendered three ways: as WhatsApp text (`formatWhatsAppReceiptMessage`),
as the staff print page `/receipts/[bill]` (58/80 mm thermal or A4: named `@page` rules in
`app/globals.css`, `?autoprint=1`, `?embed=1`), and as the public customer page `/r/[token]`.
`<ReceiptDocument>` is the single layout. `/r/[token]` is keyed on `Receipt.publicToken` (192-bit,
minted at `receipt.create`; older bills get one the first time `GET /api/receipts/message` loads
them) and 404s for an unknown token or an inactive vendor. `VendorSettings.autoPrintReceipt` loads
the print page in a hidden iframe after a POS sale, on desktop only. Settings → Receipts edits the
footer, GSTIN, paper width and auto-print.

`OrderItem.name` and `priceInPaise` are snapshots, not joins. Renaming or deleting a menu item must
not mutate historical bills.

### Drops (pre-orders)

A `Drop` is one batch a home kitchen sells ahead of time ("Saturday bakes, order by Fri 9 pm").
Core rules live in `lib/drops.ts` (read its header before touching it); buyers order on
`/s/[slug]`, the vendor works from `/drops`, `/drops/[id]` (orders board), `/drops/[id]/prep`.

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

Money and plan rules:

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
- **"I've paid" never marks an order paid.** `POST /api/s/[slug]/orders/[token]/utr` records
  `Transaction.paymentClaimedAt` (UTR optional) → display state `PAYMENT_SUBMITTED`. The vendor answers
  on the board: "Payment received" (`mark_paid` → `markOrderPaid`) or "Not received"
  (`reject_payment`: clears the claim and UTR, stamps `paymentRejectedAt`, per-order only). After a
  rejection the next claim needs a UTR (400 `reference_required`), so a hold can't be renewed by tapping.

Buyer accounts are **not** NextAuth: `Customer` + passwordless email magic link
(`lib/customer-auth.ts`), tokens and sessions stored as SHA-256 hashes only, session in the
httpOnly `awz_cust` cookie. A buyer session never touches staff RBAC or widens a vendor `select`.

Orders board freshness: order placement and board actions bump a vendor-scoped Upstash counter
(`lib/drops-signal.ts`, fire-and-forget). Instant alerts come from Web Push; board polling is only
a fallback, so both boards (`/drops/[id]` and `/orders`) poll every **6 min** (`BOARD_POLL_MS`), only
while visible (and, for drops, while it accepts orders), refetching from Postgres only when the
counter moves. Keep it above Neon's idle timeout — each tick's session check reads Postgres.

**Web Push alerts** (`lib/push.ts`): new storefront orders and submitted UPI references push to the
vendor's opted-in staff devices (`PushSubscription`, one row per device). Event-driven only — never
add a timer. `notifyVendorInBackground` wraps the send in `waitUntil` so it never blocks a buyer.
Payloads carry bill number, amount and item count only — **no buyer name, phone or address** (lock
screens are public). 404/410 from the push service deletes the row. Feature-gated on
`NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`. `public/sw.js`, the manifest,
`offline.html` and the icons are excluded from middleware; iPhones need the site added to the Home Screen.

**Spoken new-order alert** (`lib/order-voice.ts`): on each push `public/sw.js` also posts
`{ type: "awz-push", tag }` to open pages. `OrderVoiceAlerts` (vendor layout) says the fixed phrase
"New order received from customer" via `speechSynthesis` — no buyer name or amount, it is said aloud —
when Sound is on for the device (one localStorage choice shared by the board's Sound button and
Settings → Notifications), then fires `PUSH_ARRIVED_EVENT` so an open board refetches at once. Web Locks
keep several tabs from speaking together. Listener only, no timer. It needs an open page: a locked
phone gets the notification without speech.

**Offline counter sales** (`docs/PWA_OFFLINE_PLAN.md`): `/sw.js` (registered on `/pos` load) caches
`/pos` and its chunks; it never intercepts `/api/**`, `/s/**` or non-GET. Every POS checkout goes
through the IndexedDB outbox (`lib/pos-outbox.ts`): saved first, then POSTed with a `clientRef` uuid
(`@@unique([vendorId, clientRef])` — replays return the original bill with 200). If the device write
fails (broken IndexedDB) the sale is POSTed directly; with no answer it is `unsaved`, never queued:
the payment sheet stays open and the next tap replays the same `clientRef`. Queued sales show
"Offline #N" and sync on page load / `online` / tab visible — **never on a timer**. A `deferred` sale
is billed to the IST day in its `clientCreatedAt` (≤ 7 days old, `resolveSaleTime`), and its body
`vendorId` must match the resolved vendor or the route 404s (`requireVendorRole` falls back to the
first membership otherwise). UPI QRs are rendered locally by `lib/qr.ts` — no third-party QR host.

**Landing screen and the installed app** (`lib/home.ts`): sign-in, sign-up, the end of onboarding and
the manifest `start_url` all point at `/home` (`app/home/page.tsx`, Node, redirect only), which is the
one place the rule lives: setup unfinished → `/onboarding`, `publishStorefront` → `/orders`, otherwise
`/pos`. An explicit `callbackUrl` never goes through it. Never decide this in middleware (it needs
Postgres). `public/sw.js` repeats the `/home` literal: with no network it answers that navigation
with a redirect to `/pos` when a cached `/pos` exists, so the Home Screen icon still opens the offline
till. Manifest `id` stays `"/"`. Install affordances (`components/pwa/InstallPrompt.tsx`) and every
copy of the phone-alerts opt-in (`components/push/PushAlertsButton.tsx`) are views over module-level
stores (`hooks/useInstallPrompt.ts`, `hooks/usePushAlerts.ts`) — add a copy, never a second detector.
Both are event-driven: no timers, no polling.

**Order from menu** (`lib/menu-orders.ts`, opt-in `VendorSettings.acceptMenuOrders`): buyers order
everyday `MenuItem`s with no drop — same STOREFRONT transaction with `dropId = null`, same payment
paths and plan-cap rule, but no cut-off, no stock caps and no row lock (only `isAvailable` items).
Fulfilment/fee/pickup note come from `menuFulfilmentMode` / `menuDeliveryFeePaise` /
`menuPickupNote`. Buyer route `POST /api/s/[slug]/menu-orders`; vendor board `/orders` over
`/api/storefront-orders/**`, sharing order actions with drops via `lib/storefront-order-actions.ts`.
The menu board has no cut-off to stop it, so it polls every 6 min — keep it above Neon's idle
timeout.

**Bulk order actions** (`lib/order-bulk.ts` client-safe, `lib/storefront-order-bulk.ts` server): both
boards select orders and apply confirm / mark_paid / deliver via `POST /api/drops/[id]/orders/bulk`
and `POST /api/storefront-orders/bulk` (`{ orderIds: 1..50 unique, action }`, CASHIER). One
transaction per order, run in sequence, each through `applyStorefrontOrderAction` with the
single-order compound scope, so one stale order never rolls back the rest. Response
`{ data: { succeeded, failed: [{ id, error }], orders } }`; unknown and cross-tenant ids are both
`not_found`. Cancel and undeliver stay per-order. Card buttons and bulk eligibility share
`availableOrderActions()` (`lib/drops-board.ts`) — keep them on that one function.

DB-backed drops tests are opt-in: `npm run test:drops:db` (needs a throwaway `DATABASE_URL`).

### In-app Help (`/help`)

A self-help guide to getting around, linked from the shell (the "More" sheet on phones, the rail from
md). All content is in `lib/help-guide.ts` (pure, client-safe) and is trimmed to the viewer's role
through `lib/app-nav.ts`, so it never points a cashier at a screen their navigation hides. The page is
static — no reads beyond the shell's. **When you rename a screen, a Settings section or a button the
guide quotes, update `lib/help-guide.ts`**; `lib/__tests__/help-guide.test.ts` catches drifted
Settings titles and uncovered destinations, not button labels.

### Auth edge split

`lib/auth.config.ts` is edge-safe (no Prisma) and is the **only** auth module `middleware.ts` may
import; `lib/auth.ts` adds the Prisma adapter and Credentials provider on Node. Session strategy is
JWT (Credentials requires it). Type augmentation lives in `src/types/next-auth.d.ts` — putting it at
the workspace root shadows the package import. `POST /api/auth/register` creates
User + Vendor + VendorSettings + StaffMember(OWNER) in a single `prisma.$transaction`, mapping
Prisma `P2002` → 409.

### Env validation

`lib/env.ts` splits **boot-required** (`AUTH_SECRET`, `DATABASE_URL` — throw at import time) from
**feature-gated** (every integration key — optional at boot, asserted lazily via `requireEnv(key)`
when the integration actually runs). This is what lets CI build and typecheck with dummy env.
Don't promote a feature key to required.

## API route conventions

Full template and status-code table in `.cursor/rules/api-routes.mdc`. Essentials:

- `export const dynamic = "force-dynamic"` and `export const runtime = "nodejs"` on every
  vendor-scoped route (Prisma is not edge-safe; never cache cross-tenant).
- Shapes: list `{ data: T[] }` · create `{ data: T }` 201 · delete `{ success: true }` ·
  Zod fail `{ error, issues }` 400 · `AuthError` → `err.status` · plan gate 402 · 500 is
  `{ error: "Internal server error" }` with the real error only in the server log.
- Webhooks skip `requireVendorRole` and verify HMAC **before** any DB access. Middleware never runs
  on them: the `middleware.ts` matcher excludes `api/webhooks` (and `api/health`, `api/ready`).
  Other `/api/*` routes do pass through middleware, but `authorized()` in `lib/auth.config.ts`
  always lets them through so handlers return JSON 401/403 instead of a sign-in redirect.

## PII boundary (hard rule)

`Transaction.customerPhone`, customer name, and UPI UTR stay in Postgres for resend/reconciliation.
They must never reach Anthropic, an STT provider, `VoiceParseLog`, Sentry, or any log line. CSV
exports and log lines carry last-4 only. Audio bytes are streamed and discarded, never stored.

## Project rules

`.cursor/rules/*.mdc` are the enforced conventions and are worth reading before touching the
matching area — `security-first.mdc`, `tenant-isolation.mdc`, `india-locale.mdc` (always apply);
`money.mdc`, `voice-ai.mdc`, `api-routes.mdc`, `auth-rbac.mdc`, `design-system.mdc`,
`accessibility.mdc` (scoped by glob).

`.cursor/` is the source of truth. `.claude/rules/*.md` and `.claude/skills/` are generated from it
by `npm run sync:agent-rules` (`.mdc` `globs` → `.md` `paths`); edit the `.cursor/` file and re-run,
never the `.claude/` copy. `node scripts/sync-agent-rules.mjs --check` exits 1 on drift.

India-locale specifics that bite: store UTC / display IST (`Asia/Kolkata`), `DD/MM/YYYY` in UI,
phones validated as +91 10-digit and stored E.164 via `libphonenumber-js`. Use the shared helpers
rather than local copies: `lib/datetime.ts` (`formatIstDate`, `formatIstDateTime`), `lib/phone.ts`
(`normaliseIndianMobile`, `formatIndianMobile`, `lastFourDigits`).

Accessibility is POS-critical, not decorative: 44×44 px minimum tap targets (mic button 80×80),
voice states distinguishable beyond color, `aria-live` on cart and voice status, and **every
voice-only path needs a tap fallback** (`QuickAddGrid`).

## Before pushing

CI (`.github/workflows/ci.yml`) runs lint → typecheck → unit → build → bundle-size budget
(`npm run perf:budget`, see `docs/PERFORMANCE.md`), then Playwright against a Postgres service, plus gitleaks (full history) and `npm audit --audit-level=high`. A husky
pre-commit hook runs `lint-staged` (eslint `--max-warnings=0`) and gitleaks if installed locally.

Repo workflow for a meaningful change: `npm test && npm run typecheck && npm run lint && npm run build`
→ Playwright against a throwaway Postgres (see "E2E writes real rows" above) → conventional commit
→ push. Merging to `main` is the production deploy (see "Deploy topology"); never run the e2e
suite against the production deployment, because its vendor-creating specs write to the live
database.

## Stack is locked

Auth.js v5 (`next-auth` beta) with `@auth/prisma-adapter` + bcryptjs, Neon Postgres, Prisma 6,
Vercel Blob (menu item photos `app/api/menu/[id]/image`; store banner and logo `app/api/vendor/banner|logo`). Don't install `@clerk/nextjs`,
`@supabase/supabase-js` or `svix`.

## Further reading

- `ARCHITECTURE.md` — system diagrams, full data model, latency budget, ADRs, trade-offs
- `TODO.md` — open items, ordered by what breaks if ignored
- `docs/README.md` (index), `docs/OBSERVABILITY.md`, `docs/runbooks/` — production ops
- `docs/PERFORMANCE.md` — mobile numbers, what is in the shared bundle, the CI bundle budget
- `docs/archive/` — frozen April 2026 material (kickoff spec, course, demo-video script); not a
  description of the current product
