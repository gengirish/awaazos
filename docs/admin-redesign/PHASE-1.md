# Admin redesign, Phase 1: honesty fixes

Branch `feat/admin-redesign`. Background, and the decisions D1 to D4, are in `DISCOVERY.md`.

## What shipped

1. **"Voice success rate" is now "Voice share"**, with a description that says what it counts. The
   field is renamed `voiceShare` in `lib/admin-metrics.ts`, and `docs/OBSERVABILITY.md` follows.
2. **Equal windows (D4).** Every comparison is the last 7 complete IST days against the 7 before. Today
   so far is its own card. The old "this week" was 7 days plus today, against 7 days.
3. **Small-numbers mode.**
   - `describeChange` (`lib/admin-metric-change.ts`) shows "+3 sellers" or "+₹3,697.15" with a muted
     "small base" tag while the previous window is under its threshold.
   - It shows a percentage at or above the threshold.
   - Thresholds live in `ADMIN_METRICS_CONFIG.smallBase` (`lib/admin-metrics-config.ts`).
   - The separate week-over-week card is gone: each card carries its own change.
4. **Instagram counted from when tracking began.** Both the count and its denominator start at
   `max(window start, ADMIN_METRICS_CONFIG.tracking.orderChannelSince)`. The card says so, and also
   shows the untracked 7-day total.
5. **Tracking checks (tripwires).**
   - Defined in `lib/admin-tripwires.ts` and evaluated on page load from per-IST-day counts.
   - A fired check renders a dismissible amber "Possible tracking issue" banner
     (`components/admin/TrackingTripwireBanner.tsx`, hidden for 7 days per device through
     `useBannerSnooze`).
   - A "Tracking checks" list shows every check as OK, Fired, or Waiting (n of 7 tracked days).
6. **Till fix (D1):** see "Voice tagging" below.
7. Removed: the unused `getReferralMetrics` query, which was fetched but never rendered on this page;
   `/admin/referrals` still shows referral figures. Removed `wowDelta`, which is replaced by
   `describeChange`. Growth colours now use the `success` / `destructive` tokens.

## Metric definitions

All metrics count real sales only: `isSample = false` and `vendor.isDemo = false`. W = `[istDayStart(7),
istDayStart(0))`, the 7 complete IST days before today. W−1 = `[istDayStart(14), istDayStart(7))`.

| Metric | Formula | Window |
|---|---|---|
| Active sellers | distinct `vendorId` with `paymentStatus = PAID`, `paidAt` in window | W, compared with W−1 |
| Sales (GMV) | `SUM(totalPaise)`, PAID, `paidAt` in window | W, compared with W−1 |
| Bills / seller / day | median over active sellers of (PAID bills ÷ 7), rounded to 1 decimal | W |
| Voice share | PAID with `source = VOICE` ÷ all PAID; 0 with no paid bills. Storefront bills are in the denominator and are never voice | W |
| Today so far | `COUNT` and `SUM(totalPaise)`, PAID, `paidAt ≥ istDayStart(0)` | today |
| Orders from Instagram | STOREFRONT, any payment status, `orderChannel = "instagram"`, `createdAt ≥ since`; "paid" adds PAID | `since` = max(W start, 04/11/2026 12:36 IST), to W end |
| Storefront orders (denominator) | STOREFRONT, any payment status, `createdAt ≥ since` | same |

### Change display

`describeChange(current, prior, threshold, unit)`:
- If `prior < threshold`, it shows the absolute difference with `smallBase: true`.
- Otherwise it shows `(current − prior) ÷ prior` as a percentage to 1 decimal ("0.0%" under 0.05%).
- Thresholds are 20 sellers for active sellers and ₹10,000 (1,000,000 paise) for GMV. Each metric
  checks its own baseline.

### Tripwires

| Check | Fires when | Tracked from |
|---|---|---|
| Orders from Instagram | 7 tracked days with 0 Instagram orders, and > 0 storefront orders in those days | days starting at or after 04/11/2026 12:36 IST, so the first full day is 05/11 |
| Voice share | 7 days with 0 VOICE paid bills, and > 0 counter (non-STOREFRONT) paid bills in those days | always |

A day counts as tracked only if tracking had started by its 00:00 IST. With fewer than 7 tracked days a
check is "Waiting". The Instagram check can first fire on 12/11/2026 (05/11 to 11/11).

## Instagram audit: is the 0 real?

The write path is correct and tested, so the 0 is most likely real, and the old card made it look
worse than it is. Details are in `DISCOVERY.md` §2 B2. Four leaks remain on the buyer side, none of them
fixed here because they change buyer pages. I propose them as their own small PR:
- the "Open in Chrome" install card drops attribution on an untagged link;
- `src=ig` is not persisted across order again, the back links or the installed store app;
- `utm_source=ig` is ignored;
- tagged links appear only during setup.

## Voice tagging (till fix)

Before this change the till never sent `source`, so every counter sale was saved `MANUAL`, voice-built ones
included. Voice share and the seller's own Analytics voice figure were 0 by construction.

**How a sale is tagged now:**
- `counterSaleSource(lines, voiceAddedIds)` in `lib/pos-sale-source.ts` returns `VOICE` when at least one
  cart line at checkout was added by voice (its id is in the cart store's `voiceAddedIds`), otherwise `MANUAL`.
- `UpiQRModal.markPaid` sends it. That is the only `checkoutSale` caller, and it covers both cash and UPI.
- `OutboxSaleBody.source` is optional, so sales queued offline before this change still sync as `MANUAL`.

**What the server accepts:** `transactionPostBodySchema` takes only `VOICE | MANUAL` (default `MANUAL`).
`STOREFRONT` and the other sources were never posted through this route; storefront orders have their own
paths. Totals, payment, offers and bill numbering are untouched.

**Edges:**
- `voiceAddedIds` holds the ids from the latest voice order. Removing a line drops its id, and re-adding the
  item by tap makes it `MANUAL`.
- After Undo the set is cleared, so a re-rung voice sale records `MANUAL`.
- The transcript (`voiceTranscript`) is still not posted by the till.

**Tests:** `lib/__tests__/pos-sale-source.test.ts` (new) and `lib/__tests__/transaction-validation.test.ts`
(STOREFRONT, WHATSAPP and API are rejected).

## Migrations

None.

## Helpers and scripts created

- `lib/admin-metrics-config.ts`: `ADMIN_METRICS_CONFIG` (thresholds, tripwire days, tracking start dates).
- `lib/admin-metric-change.ts`: `describeChange`.
- `lib/admin-tripwires.ts`: `TRIPWIRE_RULES`, `evaluateTripwire`, `evaluateTripwires`.
- `components/admin/TrackingTripwireBanner.tsx`.
- `lib/admin-metrics.ts`: `REAL_SALES` is now exported; per-day buckets (`days`) come back with the metrics.

Local screenshot tooling, outside the repo in the session scratchpad: `pg.mjs` (embedded Postgres on
:5437), `seed.cjs` and `fix.cjs` (5 sellers at the brief's scale, 0 voice bills), `shot.cjs` (Playwright,
375 and 1280). Say if you want them moved into `scripts/`.

## Screenshots

`admin-metrics-375.png`, `admin-metrics-1280.png` and `admin-metrics-375-hidden.png` (after "Hide for 7
days") are in the session scratchpad. Seeded week: 5 sellers against 2, ₹3,800 against ₹110, 0 voice
bills, so the voice check fires. At 375 px, `scrollWidth` = 375, so there is no horizontal scroll. They
were taken just before the last two changes: the Instagram card's wording, and Instagram and Tracking
checks now side by side from `md`.

## Tests

- `lib/__tests__/admin-metric-change.test.ts`: small-numbers formatting.
- `lib/__tests__/admin-tripwires.test.ts`: each rule fires, clears and waits.
- `lib/__tests__/admin-metrics.test.ts`: windows, IST day buckets at the window edges, voice share,
  the Instagram start date, and an empty platform.
- `lib/__tests__/order-channel.db.test.ts`: updated for the complete-day window; run it with
  `npm run test:drops:db`.

## Known gaps

- Voice share is only meaningful for bills made after the till fix is deployed. Older bills stay `MANUAL`.
- The voice check fires today, correctly, and keeps firing until a voice bill is paid after the fix.
  Stores on Lite have counter voice off, so a platform of only Lite stores would fire it as a false alarm.
- The banner dismissal is per device (localStorage), not per admin.
- There is no `paidAt` index. The queries scan PAID rows, which is fine at this scale.

## Assumed, not verified

- The tracking start of 04/11/2026 12:36 IST is PR #126's merge time. The production deploy may be a few
  minutes later.
- The production numbers in the brief were not queried.
