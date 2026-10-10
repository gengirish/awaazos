# Razorpay subscriptions + 30-day trial — plan

Status: decisions taken 2026-10-09 (see "Decisions"). Schema for Phases 1 and 3 pushed to Neon
2026-10-10. Phase 0 script and Phase 1 built on `feat/razorpay-subscriptions`. Phases 2–5 not started.

Phase 1 also shipped two Phase 2 pieces, because the new plans charge base + GST: "+ GST" on every
paid price (`PlanMarketing.taxNote`), and STARTER copy now reads "Unlimited bills".

Platform SaaS billing: a vendor pays AwaazOS for STARTER through the **platform** Razorpay account
(`RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`). This is separate from storefront payments, which use
each vendor's own keys (`lib/storefront-razorpay.ts`) and must stay that way.

## Decisions

| Question | Decision |
| --- | --- |
| Trial | New sign-ups get **30 days, unlimited**, STARTER features. Replaces FREE for new vendors. |
| After the trial, unpaid | **Locked until paid**: no new sales; history, settings and billing stay reachable. |
| Existing FREE vendors | **Grandfathered**: stay on FREE (50 txn/month), no trial, never locked. |
| STARTER cap | **Unlimited** (`monthlyTxnCap: null`). Trial = paid plan, so converting changes nothing for the vendor. |
| GST | Prices are **exclusive** of 18% GST. Charged amount = base + GST. |
| Annual | Add now: **₹2,990/yr + GST** (10× monthly, 2 months free). |

### What these cost in paise

GST is computed in basis points like the rest of the codebase: `gst = Math.floor(base * 1800 / 10_000)`.

| Plan | Base | GST 18% | Razorpay plan `amount` |
| --- | --- | --- | --- |
| STARTER monthly | 29900 | 5382 | **35282** (₹352.82) |
| STARTER yearly | 299000 | 53820 | **352820** (₹3,528.20) |

Both divide exactly, so no rounding question.

**Prerequisite, outside the code:** you can only charge GST if the business is GST-registered.
Confirm the GSTIN exists, and add it under Razorpay Dashboard → Settings → Business so
subscription invoices print it, **before** creating the live plans. If it isn't registered yet,
create the plans at the base amount and change them later. Razorpay plans can't be edited, so a
change means new plans and a migration (Phase 0 note).

## What exists today

| Piece | Where | State |
| --- | --- | --- |
| Razorpay client, plan-id mapping, webhook HMAC | `lib/razorpay.ts` | Works, monthly only |
| Create subscription → `short_url` redirect | `app/api/razorpay/create-subscription/route.ts` | Works, accepts PRO (not sold) |
| Cancel | `app/api/razorpay/cancel-subscription/route.ts` | Cancels **immediately** |
| Webhook: activated / charged / cancelled / halted | `app/api/webhooks/razorpay/route.ts` | Not idempotent (see below) |
| Lazy expiry + 3-day grace | `lib/plan.ts` (`effectivePlan`), applied once in `requireVendorRole` (`lib/rbac.ts:160`) | Good, extend |
| Sign-up | `app/api/auth/register/route.ts` | Never sets a plan, so every vendor starts FREE |
| Monthly txn cap | `app/api/transactions/route.ts:195`, `lib/drops.ts:377`, `lib/menu-orders.ts:160` | FREE 50, STARTER 500 |
| Billing page | `app/(vendor)/settings/billing/page.tsx`, `components/billing/BillingManageClient.tsx` | Upgrade + cancel only |
| Tests | `e2e/razorpay-subscription.spec.ts`, `lib/__tests__/razorpay-signature.test.ts` | Auth + mocked UI only |

## Bugs in the current subscription code

1. **Duplicate webhook delivery adds 30 days twice.** `subscription.charged` does
   `planExpiresAt = max(existing, now) + 30d`. Razorpay delivers at least once, so a retry grants
   a free month. `activated` also uses `now + 30d`, not the billing period Razorpay actually charged
   for. With an annual plan this is wrong outright: +30 days for a year's payment.
2. **Event id is always `"unknown"`.** The code reads `body.id`; Razorpay sends the event id in
   the `x-razorpay-event-id` header. There is no dedupe.
3. **Cancel drops a paying vendor to FREE at once.** `subscriptions.cancel(id, false)` cancels
   immediately, then `subscription.cancelled` sets `plan: FREE, planExpiresAt: null`.
4. **Events arriving out of order.** `charged` can land before `activated`. `charged` never sets
   `plan`, so the vendor can be charged and still be on FREE until `activated` arrives.
5. **Abandoned checkouts pile up.** Every "Upgrade" click creates a new subscription and overwrites
   `razorpaySubId`. With `customer_notify: 1` the old links stay payable.
6. **PRO is accepted** by `create-subscription` though it isn't sold (TODO.md §2).

## Target design

### Access model

One new column, `Vendor.trialEndsAt DateTime?`. Set at sign-up from launch day onwards and null for
every existing vendor, so it also marks which group a vendor is in. `Vendor.plan` /
`planExpiresAt` keep meaning "what has been **paid** for".

New pure function in `lib/plan.ts`, evaluated lazily like `effectivePlan` (no timers):

```ts
type BillingAccess =
  | { kind: "paid";   plan: Plan }          // plan ≠ FREE and not past planExpiresAt + grace
  | { kind: "trial";  endsAt: Date }        // not paid, now < trialEndsAt
  | { kind: "locked"; since: Date }         // not paid, trialEndsAt set and passed
  | { kind: "free" };                        // not paid, trialEndsAt null (grandfathered)

billingAccess(vendor, now): BillingAccess
effectivePlan(vendor, now): Plan  // paid → plan; trial → STARTER; free / locked → FREE
```

- Paid always wins, so a vendor who subscribes during the trial is never locked.
- There is **no grace after the trial.** The 3-day `PLAN_EXPIRY_GRACE_DAYS` exists only so a late
  renewal webhook doesn't downgrade someone who is paying.
- A vendor in the new group who cancels or stops paying becomes `locked` after period + grace.
  A grandfathered vendor in the same situation becomes `free`. One rule: `trialEndsAt != null`
  means there is no FREE tier for that vendor.
- `requireVendorRole` adds `access` to its context next to the effective `plan`.

### What "locked" blocks

Blocked with **402** `{ error, code: "billing_locked", fallback: "billing" }` through a new helper
`requireActiveBilling(ctx)` in `lib/rbac.ts`:

| Blocked | Where |
| --- | --- |
| New POS sale | `POST /api/transactions` |
| New storefront order (drops and menu) | `placeStorefrontOrder` (`lib/drops.ts`), `lib/menu-orders.ts`. The buyer sees "not taking orders right now", **not** a 404 and nothing about billing |
| AI spend | `POST /api/ai/transcribe`, `/api/ai/parse-order`, `/api/ai/parse-drop` |
| Creating/opening drops, menu edits | drop + menu write routes |

Still allowed while locked, on purpose:

- **Offline sales made before the lock.** A `deferred` outbox sale whose `clientCreatedAt` is
  before `trialEndsAt` is accepted (it's already bounded to ≤ 7 days by `resolveSaleTime`).
  Rejecting these would lose real sales the vendor rang up during the trial.
- **Finishing existing storefront orders**: mark paid, delivered, cancel, refund. Buyers already
  paid or are waiting.
- Reading history and reports, settings, billing, sign-out, `DELETE /api/me`.
- **CSV export.** It is STARTER-gated today, so add an exception for `locked`. Keeping a
  vendor's own records away from them to push a payment is a DPDP and goodwill problem.

UI: the POS (`/pos`) and drops pages render a full-screen lock card ("Your 30-day trial ended. Subscribe to keep selling") with
Monthly / Yearly buttons, using the same subscribe flow as the billing page. A banner from day 25
onwards ("Trial ends in N days") on the vendor layout, computed on render with no timer.

### Subscriptions

**Webhook is the source of truth. Nothing runs on a timer.** Expiry stays lazy, so Neon can still
sleep. There's no reconciliation cron; a manual "Resync" (Phase 5) covers missed webhooks.

**Set `planExpiresAt` from Razorpay's period, don't do date maths.** Every subscription event
carries `entity.current_end` (unix seconds). Set `planExpiresAt = max(stored, current_end)` and
`plan` from `plan_id` on **both** `activated` and `charged`. Writing the same value twice is
harmless, so retries and out-of-order delivery stop mattering, and annual works without special
cases.

**Subscribing during the trial** creates the subscription with `start_at = trialEndsAt`. The
mandate is taken now (Razorpay's small refundable authorisation charge) and the first real charge
lands when the trial ends, so the vendor gets all 30 days. On `subscription.authenticated` with a
future `start_at`, set `plan = STARTER, planExpiresAt = start_at`. The 3-day grace then covers a
first charge that needs retries. Subscribing after the lock starts immediately (no `start_at`).

**Plan ids** become interval-aware:

| Env | Razorpay plan |
| --- | --- |
| `RAZORPAY_PLAN_STARTER_MONTHLY` | 35282 paise, `period: monthly, interval: 1` |
| `RAZORPAY_PLAN_STARTER_YEARLY` | 352820 paise, `period: yearly, interval: 1` |

`RAZORPAY_PLAN_STARTER` stays readable as an alias for monthly so nothing in flight breaks.
`RAZORPAY_PLAN_PRO` is dropped from the create path. `planFromRazorpayPlanId` returns
`{ plan, interval } | null`. `total_count`: 120 monthly, 10 yearly.

**Dedupe and audit through a ledger:**

```prisma
model SubscriptionEvent {
  id              String    @id @default(cuid())
  vendorId        String?
  razorpayEventId String    @unique   // x-razorpay-event-id, or "verify:<payment_id>"
  event           String              // "subscription.charged"
  subscriptionId  String
  paymentId       String?
  amountPaise     Int?
  status          String              // entity.status after the event
  currentEnd      DateTime?
  createdAt       DateTime  @default(now())
  vendor Vendor? @relation(fields: [vendorId], references: [id], onDelete: SetNull)
  @@index([vendorId, createdAt])
  @@map("subscription_events")
}
```

Insert first. A P2002 on `razorpayEventId` means it's a duplicate: return 200 and stop. The
ledger insert and the vendor update share one `prisma.$transaction`.

**`VendorSettings` additions** (next to the existing `razorpaySubId`):

```prisma
razorpaySubStatus      String?   // created|authenticated|active|pending|halted|cancelled|completed|paused
razorpaySubCancelAtEnd Boolean   @default(false)
billingInterval        String?   // "monthly" | "yearly"
```

#### Event → state

| Event | `plan` | `planExpiresAt` | sub status / id |
| --- | --- | --- | --- |
| `subscription.authenticated` | STARTER if `start_at` is future | `max(stored, start_at)` | status, id |
| `subscription.activated` | from `plan_id` | `max(stored, current_end)` | status, id, interval |
| `subscription.charged` | from `plan_id` | `max(stored, current_end)` | status; ledger gets payment id + amount |
| `subscription.pending` | — (grace covers it) | — | status, so billing shows "payment failed, retrying" |
| `subscription.halted` | — | — (lazy expiry) | status |
| `subscription.cancelled` | — | — (keep paid period) | status, clear id |
| `subscription.completed` | — | — | status, clear id |
| `subscription.paused` / `resumed` | — | — | status |

Never write `plan: FREE` from the webhook. Lazy expiry handles every downgrade or lock. The
transitions live in a pure `applySubscriptionEvent(current, event) → patch` in
`lib/subscription.ts`. Ignore events whose `plan_id` maps to nothing (log the masked id).

## Phases

The order is chosen so nobody can be locked before payment works properly. Trial vendors are first
locked 30 days after Phase 3 ships, so Phase 4 (in-app checkout) has that long to follow.

### Phase 0 — Razorpay plans (no deploy)

`scripts/razorpay-create-plans.mjs`:

- creates the two plans in the table above, amounts computed from `PLAN_PRICES_PAISE` /
  a new `PLAN_PRICES_YEARLY_PAISE` and `GST_BPS = 1800` (read from `lib/constants.ts`, not retyped);
- `item.name` "AwaazOS Starter (monthly)" / "(yearly)", `item.description` "₹299 + 18% GST" etc.;
- refuses to create a duplicate if a plan with the same name and amount exists (`plans.all`);
- prints the ids for `RAZORPAY_PLAN_STARTER_MONTHLY` / `_YEARLY`.

Run it in test mode first; live mode only after the GSTIN prerequisite. Changing a price later
means new plans plus `subscriptions.update({ plan_id, schedule_change_at: "cycle_end" })` for
existing subscribers.

Dashboard: webhook `https://<prod>/api/webhooks/razorpay`, secret `RAZORPAY_WEBHOOK_SECRET`,
enable all eight `subscription.*` events above.

### Phase 1 — Subscription correctness + annual (ship before taking real money)

1. Schema: `SubscriptionEvent`, the `VendorSettings` columns. **You run `npx prisma db push` on Neon before merging.**
2. `lib/subscription.ts`: `applySubscriptionEvent`, interval-aware plan-id mapping, GST amount helper.
3. Webhook rewrite: `x-razorpay-event-id`, HMAC first (unchanged), ledger with P2002 dedupe, the
   event table, one `$transaction`. Return **500** on DB errors so Razorpay retries. That's safe
   once dedupe is in place.
4. Create-subscription: body `{ plan: "STARTER", interval: "monthly" | "yearly" }`. PRO rejected.
   Reuse a stored `created` sub on the same plan and interval (return its `short_url`). Cancel a
   stored `created` sub on a different one first.
5. Cancel → at cycle end (`subscriptions.cancel(id, true)`) when `active`. Immediate only for
   `created` / `authenticated` with nothing charged yet. Set `razorpaySubCancelAtEnd`.
6. Rate-limit create/cancel per vendor (`makeLimiter`).
7. `PLAN_LIMITS.STARTER.monthlyTxnCap` / `txnPerMonth` → `null`. Update `lib/plan-copy.ts` and its test.

### Phase 2 — Pricing copy

`lib/plan-copy.ts` + pricing page + landing teaser: "30 days free, then ₹299/month + GST or
₹2,990/year + GST (2 months free)". FREE leaves the marketing surface (`MARKETED_PLANS`) but stays
in `PLAN_LIMITS` for grandfathered vendors. Billing page shows FREE only to them. Update
`app/legal/terms` and `app/legal/refund` (auto-renewal, GST, what happens at trial end and on cancel).

### Phase 3 — Trial + lock

1. Schema: `Vendor.trialEndsAt`. **`db push` first.** No backfill: existing rows stay null and grandfathered.
2. `POST /api/auth/register` sets `trialEndsAt = now + 30d` inside its existing `$transaction`.
3. `billingAccess` / extended `effectivePlan` in `lib/plan.ts`. `requireVendorRole` returns
   `access`. Every reader that loads a vendor directly (storefront, payment routes) selects
   `trialEndsAt` too, since `effectivePlan` callers already have to pass `planExpiresAt`.
4. `requireActiveBilling` and the blocked/allowed lists above, including the offline-outbox exception.
5. Lock card on `/pos`, `/drops`, `/orders`. Trial banner from day 25.
6. Subscribe-during-trial: `start_at = trialEndsAt` in `createSubscription`.

### Phase 4 — In-app checkout

Swap the `short_url` redirect for Razorpay Checkout with `subscription_id` (reuse the loader in
`components/storefront/RazorpayPayButton.tsx`). Before, the vendor left the app and never came
back. Now:

- `create-subscription` returns `{ subscriptionId, keyId, shortUrl }` (short_url as fallback).
- The handler posts `{ razorpay_payment_id, razorpay_subscription_id, razorpay_signature }` to a new
  `POST /api/razorpay/verify-subscription`. Verify
  `HMAC_SHA256(payment_id + "|" + subscription_id, KEY_SECRET)` with `timingSafeEqual`, check the
  sub id equals this vendor's `razorpaySubId` (else 404), fetch the subscription, and run the
  **same** `applySubscriptionEvent` (ledger key `verify:<payment_id>`). The lock lifts as soon as
  the payment succeeds. The webhook arriving later does nothing new.
- Prefill the owner's name and email. That's the vendor's own data going to our processor, not buyer PII.

### Phase 5 — Billing page + ops

- Billing page: plan, interval, status, "Renews on DD/MM/YYYY" / "Ends on …" (`formatIstDate`),
  trial countdown, payment-failed banner while `pending`, grace banner (`isPlanInGrace`), payment
  history from `SubscriptionEvent` (date, `formatINR`, last-4 of payment id), switch monthly ↔
  yearly (`subscriptions.update`, `schedule_change_at: "cycle_end"`).
- `POST /api/admin/subscriptions/[vendorId]/resync` (SUPER_ADMIN): fetch the sub from Razorpay and run it through `applySubscriptionEvent`.
- Runbook entries in `docs/runbooks/ON_CALL.md`: "paid but still locked", "trial vendor needs an extension" (set `trialEndsAt` by hand).
- Audit vendors on PRO set by hand (TODO.md §2): give them an explicit `planExpiresAt`.
- Update `CLAUDE.md` (drops "Money and plan rules"), `ARCHITECTURE.md`, `TODO.md` §2.

## Tests

- Unit: `billingAccess` for every group × state (trial day 0 / 29 / 30, paid during trial,
  lapsed new vs grandfathered, grace edge), `applySubscriptionEvent` (every row, duplicate,
  charged-before-activated, `current_end` earlier than stored, authenticated with future
  `start_at`), GST amounts, subscription-signature verify, PRO rejected.
- DB (`*.db.test.ts`, throwaway Postgres): webhook with signed fixtures, the same event twice →
  one ledger row and an unchanged expiry, cancel-at-end keeps access, locked vendor →
  `POST /api/transactions` 402, deferred sale from before the lock → 201, storefront order on a locked vendor rejected.
- E2E: register → trial banner absent, POS works; set `trialEndsAt` in the past (helper) → lock
  card; mocked Checkout → unlocked; cross-tenant verify-subscription → 404 in `e2e/tenant-isolation.spec.ts`.
- Manual, test mode, before going live: real test-card monthly and yearly, a subscription created
  during the trial (charge deferred to `start_at`), failed card → `pending` → `halted` → locked,
  cancel at cycle end, UPI Autopay mandate.

## Open questions (don't block Phase 0–1)

- GSTIN registration status (see the prerequisite above).
- Can a vendor in the new group get a second trial on a new vendor under the same login? Proposed
  no: set `trialEndsAt` only on a user's first vendor, and later ones start locked.
