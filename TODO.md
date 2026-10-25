# TODO

Open items with enough context to act on months later. Ordered by *what breaks if we ignore it*,
not by effort.

Each item states the claim at risk, where the code is, and how to prove it one way or the other.
An item is only done when the verification step has actually been run — not when the code looks
right.

---

## 1. Claims we make publicly that may not be true

### 1.1 WhatsApp receipts may never be delivered

**Superseded for the POS (2026-10-06):** the POS "Send on WhatsApp" and the transactions
"Resend" buttons no longer use Gupshup. `GET /api/receipts/message` returns the receipt text and
the client opens a wa.me link (`receiptWhatsappUrl`) in the vendor's own WhatsApp — the vendor
taps send. Free on every plan, no Redis, worker or template. The Gupshup path below is kept
dormant (`/api/receipts/send`, `workers/receipt.worker.ts`, and the post-sale auto-enqueue in
`POST /api/transactions` when a `customerPhone` is sent). Still to do: pricing/marketing copy and
`PLAN_LIMITS.whatsappReceipts` still describe receipts as paid-only.

**Status (Gupshup path):** unverified in production. Read from code, never observed working end to end.

The receipt is the third pillar of "speak → UPI QR → WhatsApp receipt" and it appears in the
pitch, the demo script and the marketing copy. Four independent gates sit in front of a message
actually arriving, and any one of them is sufficient to mean it never does:

1. **Plan gate.** `whatsappReceipts: false` on FREE (`lib/constants.ts`). The Hyderabad design
   partners are on FREE, so none of them have ever received one.
2. **Enqueue.** Needs `REDIS_URL` set on Vercel. On the automatic post-sale path the enqueue
   failure is logged and swallowed on purpose — correct (a Redis outage must never block a sale),
   but it means a misconfiguration is invisible. `POST /api/receipts/send` at least returns 503.
3. **Worker — confirmed missing (2026-10-05).** `workers/receipt.worker.ts` has to be running on
   Fly to drain the `send-receipt` queue. `fly deploy -a awaazos-workers` returns **"app not
   found"**: the app named in `fly.toml` (generated 2026-04-23) no longer exists on the logged-in
   account. Nothing drains *any* BullMQ queue in production — receipts, `voice-parse-log`
   telemetry and retention jobs all pile up in Redis unprocessed. Sales are unaffected (enqueue
   failures are swallowed by design).

   **To revive (future work, deliberately parked):**
   1. `fly orgs list` / `fly apps list` — rule out the app living under another org or account.
   2. Before recreating, check the plan behind `REDIS_URL`: a BullMQ worker holds a TCP
      connection and issues blocking commands 24/7, which on Upstash pay-per-command bills even
      at zero traffic (see the global scale-to-zero rule). Prefer a fixed-price plan or Redis on
      Fly.
   3. `fly apps create awaazos-workers`, then `fly secrets set` `DATABASE_URL`, `AUTH_SECRET`
      (boot-required by `lib/env.ts`), `REDIS_URL`, `GUPSHUP_API_KEY`, `GUPSHUP_APP_NAME`,
      `GUPSHUP_SOURCE_NUMBER`. `NEXT_PUBLIC_APP_URL` is already in `fly.toml` `[env]`.
   4. `fly deploy -a awaazos-workers`; confirm with
      `fly ssh console -a awaazos-workers -C "printenv NEXT_PUBLIC_APP_URL"`.

   Reviving the worker alone does **not** make receipts arrive — gate 4 below still blocks them.
4. **The session window — the likely blocker.** `lib/whatsapp.ts` posts
   `{ type: "text" }`, a free-form session message. WhatsApp delivers those only inside the
   24-hour window that opens when *the customer* messages the business. A walk-in has never
   messaged the vendor, so there is no window. Gupshup additionally requires recipients to be
   opted in. Business-initiated contact needs an **approved template**.

**Verify (10 minutes, do this before trusting anything downstream):** send a receipt to a number
that has never messaged the vendor's WhatsApp, and read the raw Gupshup response body. Do not
infer success from a 200 — check for an out-of-session / not-opted-in error code.

**If it fails**, the options are (a) register utility templates with the WABA, or (b) restructure
so the customer opens the conversation first — see 3.2, which gets this for free.

### 1.2 A receipt is not consent

Even once delivery works, the receipt does **not** grant permission to message the customer again.

- **Platform:** WhatsApp separates utility (transactional) from marketing templates, with
  different consent requirements. A receipt is utility. "New menu, order again" is marketing.
- **Law:** under DPDP consent must be specific, informed and purpose-bound, with a right to
  withdraw. Consent to receive a bill is not consent to receive offers.
- **Today:** there is no consent field, no opt-in and no unsubscribe anywhere in the codebase.
  The only opt-ins that exist are `VendorSettings.publishStorefront` and the cookie banner.

Any GTM plan that relies on re-contacting past customers needs a consent record, an opt-out path,
and approved marketing templates first. The customer-initiated design in 3.2 avoids all three.

---

## 2. Packaging contradicts the customer we sell to

**Resolved 2026-10-10** by the proposed fix at the end of this section, as built in
`docs/RAZORPAY_SUBSCRIPTIONS_PLAN.md`: new sign-ups get a 30-day free trial with STARTER limits,
STARTER is unlimited, and one plan is sold (₹299/month or ₹2,990/year, + GST). FREE (50/month)
remains only for vendors who signed up before the trial. The bullets below are kept as the record
of why; the staff-invite and "Pro is not sold" items are still open.

**ICP changed 2026-10-09** to Instagram cloud kitchens (`docs/ICP.md`): roughly 10–80 orders per
batch or day, so STARTER's 500/month now fits and the "10× below the ICP" point below applies only
to the old street-stall ICP (~200 sales/day). FREE's 50/month is still only about two batches.
Limits live in `PLAN_LIMITS` (`lib/constants.ts`).

- **FREE is 50 txn/month** — about four hours of trading. A habit cannot form before the wall
  arrives. Competing free trials in this market run 14 days, unlimited.
- **FREE has `sarvamStt: false`** — Telugu, Kannada and Tamil voice are paid-only; Hindi and
  English work free only because the browser handles them. The Hyderabad cohort speaks Telugu, so
  the free tier cannot demonstrate the core feature to the actual design partners. (Since then the
  voice-language picker, `VOICE_LANGUAGES` in `lib/constants.ts`, offers only en-IN and hi-IN on
  every plan; te/kn/ta are dormant, reachable only through legacy `voiceLang` rows.)
- **FREE has `whatsappReceipts: false`** — the third pillar is paid-only too. (Since then receipts
  go out via wa.me from the vendor's own WhatsApp on every plan; the flag gates only the dormant
  Gupshup send.)
- **STARTER is 500 txn/month** at ₹299, roughly 10× below the ICP. The customer we pitch cannot
  stay on the plan we sell him; he is forced to PRO at ₹799, which is hidden from the pricing page
  (`VISIBLE_TIERS` in `app/(marketing)/pricing/page.tsx`).

- **Staff invites don't exist.** `PLAN_LIMITS.*.maxStaff` is never read and only
  `/api/auth/register` creates a `StaffMember`, so the "3 staff logins" Starter claim was removed
  from the copy (`lib/plan-copy.ts`; `lib/__tests__/plan-copy.test.ts` fails if "staff" reappears).
  To ship: StaffMember invite/accept, enforce `PLAN_LIMITS.maxStaff`, add a tenant-isolation e2e
  case — then re-add "staff logins" to the Starter copy and relax that test.
- **Pro is not sold** — hidden from pricing (`MARKETED_PLANS` in `lib/plan-copy.ts`) and billing,
  and `POST /api/razorpay/create-subscription` rejects it (`SUBSCRIBABLE_PLANS` is STARTER only).
  Any vendor on PRO was set manually. Since 2026-10-13 the vendor's own Razorpay keys are a STARTER
  feature (trial included); what PRO still adds is 365 days of analytics instead of 90 and higher
  AI rate limits and usage caps (`lib/ratelimit.ts`, `lib/ai-usage-guard.ts`).

**Proposed fix:** time-box the trial instead of transaction-boxing it — 30 days, unlimited, every
language, WhatsApp on — then one paid tier whose cap is above real usage. Cost is some Sarvam
spend on vendors who would never convert.

---

## 3. Conditional on the repositioning decision

**Decided 2026-10-09:** repositioned to Instagram cloud kitchens (`docs/ICP.md`). The items below
were built ahead of that decision; their verification steps still stand.

### 3.1 Storefront link inside the WhatsApp receipt
**Status:** implemented on `feat/home-kitchen-drops`; delivery still unverified (blocked by 1.1).

`formatWhatsAppReceiptMessage` (`lib/whatsapp-message.ts`) now adds
"Order again: https://<host>/s/<slug>" — only when `publishStorefront` is on **and** a public
base URL is configured (`receiptStorefrontUrl()`). The worker runs on Fly, where Vercel's
`VERCEL_*` vars don't exist, so it reads `NEXT_PUBLIC_APP_URL ?? AUTH_URL`; `NEXT_PUBLIC_APP_URL`
is now set in `fly.toml` `[env]`, effective once the worker app exists again (1.1 gate 3).
Unit-tested; never seen in a real WhatsApp message because no receipt has been sent (see 1.1).

### 3.2 Tap-to-compose WhatsApp order on the storefront
**Status:** implemented on `feat/whatsapp-order`. When `VendorSettings.whatsappNumber` is set,
checkout (drops and menu) also offers the checkbox "Also send my order to the store on WhatsApp": the order is saved exactly
as today (`source` stays `STOREFRONT`, so the board, payment, stock and plan-cap rules are
unchanged), then `/s/[slug]/o/[token]?wa=1` leads with a wa.me link pre-filled with the whole order
(`formatWhatsAppOrderMessage` in `lib/storefront-order.ts`). Not done: tagging these orders
`OrderSource.WHATSAPP` (16 `source: "STOREFRONT"` filters would need widening), and a
cart-only WhatsApp message for kitchens with no payment path.

Buyer taps items on `/s/[slug]`, the page composes a pre-filled WhatsApp message to the vendor.
Buyer never leaves WhatsApp; vendor stops parsing prose out of a group chat. Also the compliant
path — a customer-initiated message opens the 24-hour window legitimately, so no templates and no
consent apparatus are needed.

### 3.3 `fssaiNumber` on storefront and receipts
**Status:** implemented on `feat/home-kitchen-drops`. Receipt delivery still blocked by 1.1.

`VendorSettings.fssaiNumber` (Settings → Online store) is shown on the storefront and printed as
"FSSAI Lic. No: …" on the WhatsApp receipt when set. Still open: confirm the current FSSAI rule for
home-scale operators (registration vs licence wording) before putting it in a pitch.

### 3.4 The real project, if discovery passes
**Status:** implemented on `feat/home-kitchen-drops` as **Drops** — see `ARCHITECTURE.md` §11.

Remote pre-orders with paid/unpaid state, a `Customer` entity (magic-link buyer accounts), cut-off
times evaluated lazily, capped stock, orders board, prep sheet, and three payment paths (UPI intent +
UTR, pay on delivery, the vendor's own Razorpay keys). Covered by unit tests, `npm run test:drops:db`
and `e2e/drops.spec.ts`. Not yet verified in production: vendor-Razorpay checkout and webhook
against a real Razorpay account, buyer magic-link email delivery, and anything WhatsApp (1.1).
`PLAN_LIMITS.*.razorpayLinks` gates it (`isOnlinePaymentEnabled`, `PUT /api/vendor/payments`): on from
STARTER, so trial vendors have it too.

### 3.5 Drops: open items found while building it

- ~~**Orders board keeps Neon awake during order windows.**~~ **Resolved:** the board's signal
  check sends a board pass (`lib/board-pass.ts`) checked against the JWT session, so it reads no
  Postgres and runs every 30 s; without a pass or KV it falls back to every 6 min (`BOARD_POLL_MS`).
- **Marking an EXPIRED order paid can oversell.** After the 15-minute hold lapses its stock is
  released and may be resold; the board still lets the vendor tap Mark paid (e.g. a late UTR), which
  re-counts that stock. Either re-check remaining stock under the drop lock in `mark_paid`, or warn
  the vendor before allowing it.
- **The monthly cap can be overshot.** The cap check at placement counts only *paid* storefront
  orders, so several unpaid orders can each pass it and later all get paid. Bounded by order volume
  per drop; decide whether to count in-flight holding orders too.
- **Non-Latin names in the OG image fetch a font at runtime.** `app/s/[slug]/opengraph-image.tsx`
  pulls a Google font when a vendor or item name isn't Latin (Telugu, Devanagari…). Adds latency and
  an external dependency to link previews; bundle the subset fonts instead.
- **`prisma db push` to Neon before deploying this branch.** Schema changes are additive only (new
  tables, nullable columns, defaults), but the app will 500 on drops/storefront paths until the push
  has run.
- **Email link scanners can burn buyer sign-in links.** `GET /api/s/customer/verify` consumes the
  token, so Outlook Safe Links–style prefetchers land the buyer on "expired". Fix: a confirm page
  whose "Continue" button POSTs.
- **Login CSRF on buyer accounts.** An attacker can send a victim their own sign-in link so the
  victim's next orders attach to the attacker's account. Show "Signed in as <email>" in checkout.
- **Online (Razorpay) payments are credited as UPI revenue.** `markOrderPaid` splits DailySummary by
  `paymentMethod`, which stays `UPI` when a buyer pays by card through Checkout.
- **Paid after cancel.** A buyer can pay through Checkout after the vendor cancelled; money moves but
  the order is not marked paid (logged as `storefront_rzp_paid_unapplied`). Vendor refunds by hand.
- **Menu ordering can be left without a way to pay.** `acceptMenuOrders` is guarded only when it is
  switched on. If the vendor later clears the UPI ID or turns off pay-on-delivery, buyers reach a
  checkout with no payment option (the sheet shows a "message the kitchen" note). Unpublishing is
  safe (the buyer route 404s).
- **"Order again" receipt link** — `NEXT_PUBLIC_APP_URL` is set in `fly.toml` `[env]`
  (`https://awaazos.intelliforge.tech`; whether that is the production domain is open, see §5), but
  the Fly worker app doesn't exist; see 1.1 gate 3.

### 3.6 Real new-order alerts for vendors

**Web Push implemented on `feat/web-push`** (option 1 below, plus the small wins): `lib/push.ts`,
`public/sw.js`, `app/manifest.ts`, `/api/push/**`, Settings → Notifications, "Get alerts on this
phone" on the orders board. Still unverified: **real delivery on devices** — Android Chrome with the screen
locked, and an iPhone (iOS 16.4+) with AwaazOS added to the Home Screen. Headless CI can't reach a
push service. Known gap: the button trusts this browser's subscription, so a row removed from another
device leaves it saying "on" until toggled. The original analysis follows.

**Spoken alert since then (`lib/order-voice.ts`):** each push also reaches open pages, which say
"New order received from <first name>" with an on-device voice and make an open board refetch at
once. Sound is one per-device localStorage choice, **on by default**, shared by the board's Sound
button and Settings → Notifications. It still needs an open page: a locked phone gets the
notification without speech.

Before Web Push, the only alert was a Web Audio beep when the board's own poll found new orders.
Its limits, kept for the record:

- **Delay.** It beeped only when the board checked: every 6 min.
- **Screen on only.** Polling stops when the tab is hidden or the phone is locked, so nothing beeped
  in a pocket — the vendor had to keep the board open and visible.
- **Not remembered.** Sound started off on every page load. (Now remembered and on by default.)

Options, cheapest first:

1. **Web Push** (service worker + VAPID keys; send from the order routes after commit,
   fire-and-forget like the KV signal). Event-driven, so it also removes the need for fast polling —
   no scale-to-zero cost. Works with the screen off on Android Chrome; iPhone needs iOS 16.4+ and the
   site added to the Home Screen. Needs a `PushSubscription` table (vendor/staff-scoped) and an
   opt-in prompt on the board.
2. **WhatsApp to the vendor** on each new order — most reliable for this audience, but needs an
   approved utility template and a running worker, so it is blocked by 1.1 (gates 3 and 4).
3. **Small wins regardless:** remember the Sound choice per device (localStorage, try/catch), and
   show "Last checked HH:MM · next check in N min" on the orders board so the delay is visible.

---

## 4. Correctness and quality

### 4.1 Tap targets are 40px for mouse users
**Mostly resolved (`d2b4996`, 2026-10-11):** `Button`, `Input`, `SelectTrigger`, `SelectItem` and the
Dialog / Sheet close buttons now carry `touch-target`, which sets a 44px floor under
`@media (pointer: coarse)` (`app/globals.css`). Phones and tablets get 44px; a desktop with a mouse
keeps the 40px `h-10` density on purpose.

Still open: the `test.fixme` in `e2e/accessibility.spec.ts` ("auth page buttons meet the 44px
minimum") predates that change and its comment is stale. Run it on the Pixel 7 project (coarse
pointer) and un-skip it there, or delete it if desktop density is the accepted rule.

### 4.2 E2E gaps that need infrastructure first
- **StaffRole enforcement** (a CASHIER refused an OWNER-only write) — untestable because there is
  no staff-management API to create a non-owner member.
- **CSV export contents** — the PII rule says last-4 phone only and DD/MM/YYYY IST, both untested,
  because the route is STARTER-gated and nothing can upgrade a plan from a test.

### 4.3 E2E does not run on CI
**Answered:** the Playwright job in `.github/workflows/ci.yml` is switched off (`if: false`,
2026-10-13), so nothing gates `main` on E2E. The suite runs only locally against a throwaway
Postgres (recipe in `CLAUDE.md`), and a merge is a production deploy. Decide whether to re-enable
the job (it is fully defined: Postgres 15 service, `prisma db push`, chromium) or keep the local
step as the rule. `docs/BRANCH_PROTECTION.md` should match whichever is chosen.

### 4.4 Customer phone numbers are stored as typed
`POST /api/transactions` (`transactionPostBodySchema` in `lib/transaction-post-body.ts`) and
`POST /api/receipts/send` accept `customerPhone` as any string. They only `trim()` it: no +91
10-digit check and no E.164 normalisation via `libphonenumber-js`, which the India-locale rule
requires. The raw value goes into `Transaction.customerPhone` and into the `send-receipt` job.
Left out of the Phase 3 cleanup because adding validation changes behaviour (a request that
succeeds today would start returning 400). Decide whether to reject or normalise, then add it to
both routes.

### 4.5 Unused Prisma fields — don't drop yet
Never referenced in `app/`, `lib/`, `components/`, `workers/` or `hooks/` (re-checked 2026-10-07):

- `VendorSettings.discountEnabled`, `hsnDefault`, `razorpayCustomerId`
- `Transaction.paymentLinkUrl`
- `Receipt.pdfUrl`
- `OrderSource.WHATSAPP` and `OrderSource.API`

Read but never written: `VendorSettings.theme` (storefront) and `VendorSettings.taxEnabled` /
`taxPercent` (POS cart). Nothing in the app sets them. (`Vendor.logoUrl` is now set by
`POST /api/vendor/logo`, Settings → Online store.)

`Transaction.razorpayOrderId` and `razorpayPaymentId` were on the original audit list but are now
used by storefront Razorpay checkout (Drops).

Dropping a column is destructive under `prisma db push` and there are no migration files, so
decide per field (drop, or build the feature) rather than in bulk. Re-run the grep first:
`rg -w "<field>" app lib components workers hooks`.

### 4.6 Security hardening deferred from the MVP
- **Nonce-based CSP.** `script-src` in `next.config.mjs` still allows `'unsafe-inline'` and
  `'unsafe-eval'` for Next.js inline hydration. Moving to nonces removes both.
- **Password strength.** `lib/password-strength.ts` is a custom heuristic (length, character
  classes, a common-password blocklist). Swap in zxcvbn if false positives become a problem, or add
  a HaveIBeenPwned k-anonymity breach check. Both were deferred to avoid 600 KB+ of bundle.

---

## 5. Ops

- **Production domain is undecided.** This file and `fly.toml` (`NEXT_PUBLIC_APP_URL`) use
  `https://awaazos.intelliforge.tech`; README.md, PITCH.md and `docs/DEMO_GUIDE.md` use
  `https://awaazos.vercel.app`. Pick one (cleanup plan decision D5), then update `AUTH_URL`,
  `fly.toml` and the docs to match.
- **Retention never runs on a schedule.** `workers/retention.worker.ts` deletes `VoiceParseLog` rows
  older than 90 days and `Receipt` rows older than 7 years, but the only trigger is
  `POST /api/admin/retention/run` (platform ADMIN session). There is no cron and no UI button, so
  it runs only when someone POSTs by hand, and it also needs the Fly worker running (1.1 gate 3).
  If a cron is added, run it at most once a day: the job touches Neon, which scales to zero, and the
  route's per-UTC-day `jobId` already makes repeat calls the same day a no-op.
- **`AUTH_URL` is unset on Vercel.** Reset links are correct anyway via the
  `VERCEL_PROJECT_PRODUCTION_URL` fallback, but Auth.js also uses `AUTH_URL` for callback URLs.
  Set it to the production domain once that is decided (see above).
- **Vercel CLI is not authorized locally.** `vercel --prod` fails with "Not authorized"; deploys
  currently happen via the GitHub integration on push to `main`. Run `vercel login` if CLI deploys
  or `vercel env pull` are wanted.
- **`.env` holds production credentials and is read by both Prisma and Next.** Never run
  `npm run e2e` against it — the suite registers vendors and rings up sales. Throwaway-Postgres
  recipe is in `CLAUDE.md`.
