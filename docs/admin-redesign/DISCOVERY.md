# Admin dashboard redesign: discovery

Step 0 of the admin redesign (brief: redesign `/admin/metrics`, and touch `/admin/vendors`, as a
decision tool for 5 to 50 sellers). Written 08/11/2026 against `main` at 15ac863. Nothing here is built yet.

## 1. What exists

### Stack and routing

- Next.js App Router, Prisma 6 on Neon, Auth.js v5. Admin pages are async server components
  (`dynamic = "force-dynamic"`) that call `lib/*` through Prisma directly. API routes under
  `/api/admin/**` exist only for the mutations that client forms make.
- `app/admin/<page>/page.tsx` for metrics, vendors, survey, referrals, demo-stores, earnings,
  communities, pricing and admins. There is no admin layout and no admin `not-found.tsx`: each page
  renders its own header and `<AdminNav>` (`components/admin/AdminNav.tsx`, link flags
  `superAdminOnly` / `sales`).

### Guard

- Pages: `requirePlatformRole(role)` (`lib/rbac.ts:126`) re-reads the User row, so the JWT role is not
  trusted, and checks that the session is not stale. Each page catches `AuthError` and calls `notFound()`,
  so a non-admin gets a 404, never a 403. Middleware only checks that a session exists.
- APIs: `adminRoute(role, name, handler)` (`lib/admin-api.ts:19`) turns `AuthError` into 404
  `{ error: "Not found" }`, `ZodError` into 400 `{ error: "Invalid input", issues }`, and anything else
  into a logged 500.
- Roles today: `/admin/metrics` needs ADMIN. `/admin/vendors` needs SUPER_ADMIN, and owner contact
  details (phones, emails) appear only there.

### Current `/admin/metrics` (`app/admin/metrics/page.tsx`, `lib/admin-metrics.ts`)

Base filter everywhere: `REAL_SALES = { isSample: false, vendor: { isDemo: false } }`. "This week" is
`paidAt >= istDayStart(7)`, which is IST midnight 7 days ago up to now: 7 full IST days plus today so far,
with no upper bound. "Last week" is `[istDayStart(14), istDayStart(7))`, exactly 7 days.

| Card | Formula today | Problem |
|---|---|---|
| Weekly active vendors | distinct `vendorId` with a PAID bill, `paidAt` this week | none |
| Bills / vendor / day | median over active vendors of (paid bills ÷ 7) | divides by 7 over a window longer than 7 days |
| "Voice success rate" | PAID with `source = VOICE` ÷ all PAID, this week | it is a share, not a success rate, and it is **always 0** (bug B1 below) |
| Weekly GMV | `SUM(totalPaise)` of PAID, this week | none (rendered with `formatINR`) |
| Orders from Instagram | STOREFRONT with `orderChannel = "instagram"`, `createdAt` this week, any payment status; denominator is all STOREFRONT in the same window | the window starts before the field existed (bug B2) |
| Week-over-week growth | `(this − last) / max(last, 1)` for active vendors and GMV | % on a tiny base; the current window is longer than the prior one, so growth is biased upward |

- `getReferralMetrics` is fetched but never rendered (`page.tsx:6, :55`).
- Growth colours use raw `text-emerald-600` / `text-rose-600`, not the design tokens.
- `lib/__tests__/admin-metrics.test.ts` mocks Prisma and depends on the order of the `count` calls.

### Current `/admin/vendors`

- Newest 50 stores, searchable (`lib/admin-vendors.ts`).
- Each row is a card showing: billing state, `StoreHealthLine` (last order, published, drops this week),
  survey answers, `StoreContactCard` (feedback ask through `OutreachWhatsApp` → wa.me), and the free-access
  and price forms.
- No bill counts, GMV or voice share per store. The page is already long and full of forms.

### Data model (exact)

- **Paid** = `Transaction.paymentStatus = "PAID"`, with the time in `paidAt`.
  - Counter sales set `paidAt` at sale time.
  - Storefront orders get it in `markOrderPaid` (`lib/drops.ts:590`).
  - Cancelling a paid order sets it to `REFUNDED`. An undone counter sale deletes the row.
- **Storefront order** = `source = "STOREFRONT"`. `dropId` is set for a drop order and null for a menu order.
- `OrderSource`: `VOICE, MANUAL, WHATSAPP, STOREFRONT, API`. There is no QUICKADD value; quick-add is `MANUAL`.
- `PaymentStatus`: `PENDING, PAID, FAILED, REFUNDED`. `FulfilmentStatus`: `PLACED, CONFIRMED, CANCELLED, DELIVERED`.
- `Transaction.orderChannel` is `"instagram"` or null. It was added by migration `20261104000000_order_channel`
  (PR #126, merged 04/11/2026 12:36 IST) with no backfill.
- Order-level timestamps already stored:
  - `createdAt` (placed)
  - `paymentClaimedAt` (buyer's "I've paid")
  - `paidAt`
  - `cancelledAt`
  - `outForDeliveryAt`
  - `buyerReceivedAt`
  - `razorpayOrderId` (a Razorpay order was created; no timestamp)
- `Vendor`:
  - `createdAt`, `isDemo`, `demoExternalRef` (kept after claim, so "was a demo" = not null), `isActive`,
    `stallType`
  - **`city String?`**: free text. Set by onboarding step 1 and Settings. For demo stores it comes from
    `profile.area`, which mixes locality and city ("Kondapur, Hyderabad"). Sign-up does not set it.
  - There is no `archivedAt` on Vendor.
- Demo lifecycle:
  - created = `DemoAuditLog(action="create").createdAt`
  - claimed = `DemoHandover.usedAt`, also `DemoAuditLog(action="claim")`; `demoStage` in
    `lib/admin-demo-stores.ts:93` already derives `claimedAt`
  - first paid bill = `MIN(paidAt)` over PAID, not `isSample`. It is not stored.
- `DailySummary` (per vendor per IST day: revenue, transactions, items, cash/UPI) excludes samples but has
  no source or channel split.
- `VoiceParseLog` is written only by the BullMQ worker. The Fly worker app does not exist (TODO.md 1.1), so
  in production this table is effectively empty.
- Indexes on Transaction: `[vendorId, createdAt]`, `[vendorId, paymentStatus]`. **There is no index on
  `paidAt`.** At 5 to 50 sellers the scans are trivial; I'd add `[vendorId, paidAt]` only if it is needed.
- Admin-editable table pattern to copy: `Community` (`lib/community.ts` schema + `lib/community-server.ts`
  + `adminRoute` routes + `/admin/communities` page).

### Helpers to reuse

| Need | Helper |
|---|---|
| ₹ formatting | `formatINR(paise)` gives `₹1,23,456.78` and throws on non-integers; `formatINRCompact` |
| Dates and IST days | `formatIstDate` (DD/MM/YYYY), `formatIstDateTime`; `istDayStart(daysAgo, now)` in `lib/admin-metrics.ts`; `addIstCalendarDays`, `utcToIstParts`; `getIstTodayStart` (gives the `@db.Date` key, not the real IST instant) |
| wa.me links | `receiptWhatsappUrl(text, phone)` (URL-encodes, accepts 10-digit or E.164, null on a bad number); `outreachWhatsappUrl`; `fillTemplate` with `{firstName}` / `{storeName}`-style tokens in `lib/demo-pipeline.ts:275`; `OutreachWhatsApp`, the editable-text-then-open button; `storeContact()` (WhatsApp number first, then sign-up phone) |
| Dismissible banner | `useBannerSnooze(key, days)` (localStorage, try/catch, in-memory fallback); `Notice` component (`tone="warning"`) |
| UI | `Card`, `Badge` (no success/warning variants; tokens `bg-warning` etc. exist), `Table`, `EmptyState`. recharts is installed but lazy-loaded only in vendor analytics. No sparkline exists. |
| Tests | Vitest in `lib/__tests__`, pure helpers take `now`; DB tests are `*.db.test.ts` added to `test:drops:db`; screenshots inline in Playwright (`e2e/voice-menu.spec.ts:318` takes 375 and 1280) |

## 2. Bugs and tracking gaps found

### B1. Voice share is always 0: a real bug, not a real 0

- `OutboxSaleBody` (`lib/pos-outbox.ts:32`) has no `source` field, so the POS never sends one.
- `transactionPostBody` defaults it to `MANUAL` (`lib/transaction-post-body.ts:28`).
- Nothing else in the app writes `VOICE`, so **every counter sale is `MANUAL`**, voice-built carts included.
- The same bug zeroes voice adoption on the seller's own Analytics page (`app/(vendor)/analytics/page.tsx:183`).
- `VoiceParseLog` can't stand in for it, because no worker runs in production.
- Separately, the body accepts any `OrderSource`, so a POS client could post `STOREFRONT`. It should accept
  only `VOICE | MANUAL`.

**Fix (small):** the cart already knows which lines came from voice (`voiceAddedIds` in
`components/pos/OrderCart.tsx:138`). `checkoutSale` should send `source: "VOICE"` when at least one line was
added by voice.
- This touches the sale write path, which is not billing or payment logic, but it is outside "read-only".
  **It needs your OK.**
- Bills made before the fix stay `MANUAL`. A bet on voice share can only be measured from the day the fix ships.

### B2. Instagram = 0 is probably real, but the metric overstates the miss

The write path is correct and covered by `lib/__tests__/order-channel.db.test.ts`:
- UA `/\bInstagram\b/i` read from the order POST header, or `src=ig`.
- Both order routes write `orderChannel`.

Why the number is still misleading, and where attribution leaks:

1. **The window starts before the field existed.** The 7-day window starts 01/11, but `orderChannel` was
   written only from about 04/11 midday. Up to half of the 55 orders could never have been counted. Fix:
   clamp both numerator and denominator to `max(windowStart, ORDER_CHANNEL_SINCE)` and say so on the card.
2. **The "Open in Chrome" install card pushes Android Instagram buyers out of the in-app browser.**
   `StoreInstall` and `openInChromeIntentUrl` keep the query, but an untagged link loses attribution once
   the UA is Chrome. Fix: add `src=ig` to the intent URL when the current UA is Instagram.
3. **`src` is never persisted.** It is read from `location.search` only at submit. Order again, the
   back-to-store links on the order and account pages, `OtherCartsNotice` and the installed store app all
   drop it. Fix: keep it in sessionStorage per store.
4. **Instagram's own bio-link tag (`utm_source=ig`) is ignored.** `orderSrcFromSearch` reads only `src`.
   I couldn't verify this tag in code; it is from what I know of Instagram's behaviour.
5. **Few sellers have a tagged link.**
   - The tagged "Copy link" shows only on the onboarding done screen and while the setup checklist is open.
   - The link text shown beside it, Settings → Online store, the app nav "Share store link" and the board
     share menus all copy the untagged URL.
   - Every bio link set before 04/11 is untagged.
6. Minor:
   - An unknown `src` value gets a 400 for the whole order (`lib/zod-drops.ts:183, 217`).
   - The story button also tags referral links.
   - No E2E test checks that the browser actually posts `src`.

Fixes 2 to 4 are buyer-path changes, not admin reads, so I'd ship them as their own small PR.

### B3. Growth windows are unequal

The current window is 7 days plus today so far, against a prior window of exactly 7 days. Proposal: compare
the last 7 complete IST days with the 7 before, and show "today so far" separately. **This changes the 55
reference number**, so Phase 3's reconciliation will use whatever window we settle on, and the old and new
counts can be compared side by side once.

## 3. Which requested metrics can't be computed yet

| Metric | Status | Smallest addition |
|---|---|---|
| Voice share | wrong data (B1) | `source: "VOICE"` from the POS; correct only from the fix date |
| IG orders | computable from 04/11 | clamp the window (B2.1); leak fixes B2.2 to B2.4 |
| Heartbeat: sparkline, idle days, 7d GMV, 7d bills, voice share, badges | computable now from `Transaction` (voice share after B1) | none |
| Funnel: **storefront view** | not tracked | per-store daily counter, see below |
| Funnel: **cart** | not tracked; the cart is browser-only state | needs a buyer-facing write (see decision D2) |
| Funnel: **order placed** | yes, `createdAt` | none |
| Funnel: **payment initiated** | partial: `razorpayOrderId` (no time), `paymentClaimedAt` (UPI claim) | `Transaction.paymentStartedAt`, stamped once by the existing Razorpay order route and the existing UTR/claim route |
| Funnel source split | Instagram only | WhatsApp needs a `src=wa` tag on the wa.me share texts (WhatsApp opens links in the phone's browser, so there is no UA signal); "direct" = untagged with a non-Instagram UA; "other" = reserved for later tags |
| Bet board | nothing stored | new `AdminBet` table |
| GTM timeline: admin markers | nothing stored | new `AdminTimelineEvent` table |
| GTM auto markers | computable: demo created (`DemoAuditLog`), first paid bill (`MIN(paidAt)`) | none |
| Activation funnel by city | computable; `city` is free text | city key derived at read time (text after the last comma, trimmed, lowercased); no migration |

### How to count views and carts without waking Neon

`/s/[slug]` already reads Postgres on render, so a write there is the only extra cost, but a DB write on
every buyer view is the wrong shape. Instead:

- Increment an Upstash counter per (store, IST day, stage, channel), with a 60-day TTL, using
  `lib/kv.ts`, fire-and-forget, no PII. This is the same pattern as `bumpOrderSignal`.
- For views, increment from the page render itself, so **no new endpoint** is needed.
- The admin page reads the counters on render. No cron, no timer, nothing on Neon.
- If KV is down, the stage shows "not tracked" for that day, never a made-up number.

## 4. Where the brief and the repo differ

| Brief | Repo | Plan |
|---|---|---|
| `ApiResponse<T>` envelope | no such type; `{ data }` / `{ error, issues }` / `{ success: true }` (`.cursor/rules/api-routes.mdc`) | follow the repo |
| Zod on API outputs | Zod only on inputs, nowhere on outputs | Zod on inputs; new reads stay server components with no API. I can add output schemas to the new bet and marker routes if you want them; that would be a first in the repo |
| Cashfree | there is none; payments are Razorpay (vendor-owned keys or OAuth) and UPI intent | Razorpay is only read, never touched; the only payment-adjacent write is the optional `paymentStartedAt` stamp |
| "Template file" for Nudge copy | templates are TS functions (`lib/outreach-message.ts`) filled by `fillTemplate` | see decision D3 |
| No new public endpoints | the cart stage needs one | see decision D2 |
| Admin guard | metrics needs ADMIN; contacts are SUPER_ADMIN-only | Nudge and Remind buttons (they carry seller phones) show to SUPER_ADMIN only; ADMIN sees the grid without them |

## 5. Decisions (09/11/2026)

- **D1, voice fix:** in Phase 1. The till sends `source: "VOICE"` when a cart line was added by voice, and
  the server accepts only `VOICE | MANUAL` from the till.
- **D2, cart stage:** skipped. The funnel is view → order placed → payment started → paid; cart shows
  "not tracked". Views are counted from the page render, with no new endpoint.
- **D3, Nudge copy:** a text file in the repo with `{token}` variables.
- **D4, windows:** the last 7 complete IST days against the 7 before, plus a separate "today so far" line.

## 6. Assumptions (not verified)

- **Small-numbers mode** is applied per metric: the vendor delta checks the vendor baseline (< 20), and
  the GMV delta checks the GMV baseline (< ₹10,000). Today both are below their thresholds, so both show
  absolute deltas.
- **Badge precedence** is New (store < 14 days old), then At risk, then Watch, then Healthy.
  - The "≥ 50% WoW drop" rule fires only when the prior week had ≥ 4 paid bills; otherwise 2 → 1 would
    flag At risk.
  - The 4-bill floor is my addition.
- **Bet status:**
  - 🟢 when the comparator holds now.
  - 🟡 when it doesn't hold and the deadline hasn't passed.
  - 🔴 when it doesn't hold at the deadline.
  - No trend projection.
- **Tripwires** need a related metric that is > 0 on the same days. An IG tripwire counts only days after
  04/11. A voice tripwire fires today, correctly, because of B1.
- Production numbers in the brief (5 vendors, 55 orders, ₹3,807.15) are taken as given. I did not query
  Neon.
- Instagram's `utm_source=ig` bio-link behaviour is from general knowledge, not checked here.
