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

Stated ICP does ~200 sales/day (~5,200/month). Limits live in `PLAN_LIMITS` (`lib/constants.ts`).

- **FREE is 50 txn/month** — about four hours of trading. A habit cannot form before the wall
  arrives. Competing free trials in this market run 14 days, unlimited.
- **FREE has `sarvamStt: false`** — Telugu, Kannada and Tamil voice are paid-only; Hindi and
  English work free only because the browser handles them. The Hyderabad cohort speaks Telugu, so
  the free tier cannot demonstrate the core feature to the actual design partners.
- **FREE has `whatsappReceipts: false`** — the third pillar is paid-only too.
- **STARTER is 500 txn/month** at ₹299, roughly 10× below the ICP. The customer we pitch cannot
  stay on the plan we sell him; he is forced to PRO at ₹799, which is hidden from the pricing page
  (`VISIBLE_TIERS` in `app/(marketing)/pricing/page.tsx`).

**Proposed fix:** time-box the trial instead of transaction-boxing it — 30 days, unlimited, every
language, WhatsApp on — then one paid tier whose cap is above real usage. Cost is some Sarvam
spend on vendors who would never convert.

---

## 3. Conditional on the repositioning decision

Only start these if the two-week discovery test says the fire is real. See the positioning memo.

### 3.1 Storefront link inside the WhatsApp receipt
**Status:** implemented on `feat/home-kitchen-drops`; delivery still unverified (blocked by 1.1).

`formatWhatsAppReceiptMessage` (`lib/whatsapp-message.ts`) now adds
"Order again: https://<host>/s/<slug>" — only when `publishStorefront` is on **and** a public
base URL is configured (`receiptStorefrontUrl()`). The worker runs on Fly, where Vercel's
`VERCEL_*` vars don't exist, so it reads `NEXT_PUBLIC_APP_URL ?? AUTH_URL`; `NEXT_PUBLIC_APP_URL`
is now set in `fly.toml` `[env]`, effective once the worker app exists again (1.1 gate 3).
Unit-tested; never seen in a real WhatsApp message because no receipt has been sent (see 1.1).

### 3.2 Tap-to-compose WhatsApp order on the storefront
Buyer taps items on `/s/[slug]`, the page composes a pre-filled WhatsApp message to the vendor.
Buyer never leaves WhatsApp; vendor stops parsing prose out of a group chat. Also the compliant
path — a customer-initiated message opens the 24-hour window legitimately, so no templates and no
consent apparatus are needed.

### 3.3 `fssaiNumber` on storefront and receipts
**Status:** implemented on `feat/home-kitchen-drops`. Receipt delivery still blocked by 1.1.

`VendorSettings.fssaiNumber` (Settings → Pre-orders) is shown on the storefront and printed as
"FSSAI Lic. No: …" on the WhatsApp receipt when set. Still open: confirm the current FSSAI rule for
home-scale operators (registration vs licence wording) before putting it in a pitch.

### 3.4 The real project, if discovery passes
**Status:** implemented on `feat/home-kitchen-drops` as **Drops** — see `ARCHITECTURE.md` §11.

Remote pre-orders with paid/unpaid state, a `Customer` entity (magic-link buyer accounts), cut-off
times evaluated lazily, capped stock, orders board, prep sheet, and three payment paths (UPI intent +
UTR, pay on delivery, the vendor's own Razorpay keys). Covered by unit tests, `npm run test:drops:db`
and `e2e/drops.spec.ts`. Not yet verified in production: vendor-Razorpay checkout and webhook
against a real Razorpay account, buyer magic-link email delivery, and anything WhatsApp (1.1).
`razorpayLinks` in `PLAN_LIMITS` is still a flag with nothing behind it — storefront Razorpay does
not use it.

### 3.5 Drops: open items found while building it

- **Orders board keeps Neon awake during order windows.** `/api/drops/[id]/signal` reads its
  counter from Upstash, but `requireVendorRole` inside it hits Postgres (session → membership) on
  every poll — every 20 s while the board is visible and a drop is accepting orders. A vendor who
  leaves the board open all evening pins Neon awake for the whole window, against the global
  scale-to-zero rule. Options: a JWT-only session check plus a KV-cached `(userId, vendorId)`
  membership for this one route, or a poll interval above Neon's idle timeout. **Needs an owner
  decision.**
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
- **Menu orders board refreshes every 6 minutes.** "Order from menu" has no cut-off, so its board
  can stay open all day; polling faster would keep Neon awake (each tick runs `requireVendorRole`).
  Faster alerts need the same Postgres-free session check as the drops board item above.
- **Menu ordering can be left without a way to pay.** `acceptMenuOrders` is guarded only when it is
  switched on. If the vendor later clears the UPI ID or turns off pay-on-delivery, buyers reach a
  checkout with no payment option (the sheet shows a "message the kitchen" note). Unpublishing is
  safe (the buyer route 404s).
- **"Order again" receipt link** — `NEXT_PUBLIC_APP_URL` is set in `fly.toml` `[env]`
  (`https://awaazos.intelliforge.tech`), but the Fly worker app doesn't exist; see 1.1 gate 3.

### 3.6 Real new-order alerts for vendors

Today the only alert is the orders board's **Sound** toggle (`components/drops/orders/OrdersBoard.tsx`,
`beep()`): a Web Audio beep when the board's own poll finds new orders. Its limits:

- **Delay.** It beeps only when the board checks: every 6 min on `/orders` (menu orders), every 20 s
  on a drop board while it takes orders. Refresh checks immediately.
- **Screen on only.** Polling stops when the tab is hidden or the phone is locked, so nothing beeps
  in a pocket — the vendor has to keep the board open and visible.
- **Not remembered.** Sound starts off on every page load (browsers need a tap before playing audio).

Options, cheapest first:

1. **Web Push** (service worker + VAPID keys; send from the order routes after commit,
   fire-and-forget like the KV signal). Event-driven, so it also removes the need for fast polling —
   no scale-to-zero cost. Works with the screen off on Android Chrome; iPhone needs iOS 16.4+ and the
   site added to the Home Screen. Needs a `PushSubscription` table (vendor/staff-scoped) and an
   opt-in prompt on the board.
2. **WhatsApp to the vendor** on each new order — most reliable for this audience, but needs an
   approved utility template and a running worker, so it is blocked by 1.1 (gates 3 and 4).
3. **Small wins regardless:** remember the Sound choice per device (localStorage, try/catch), and
   show "Last checked HH:MM · next check in N min" on the menu board so the delay is visible.

---

## 4. Correctness and quality

### 4.1 Tap targets are 40px against a documented 44px rule
`accessibility.mdc` requires 44×44 for any tap target and globs `**/*.tsx`, but the shared Button
default is `h-10` (`components/ui/button.tsx`). ~11 buttons across auth and marketing are 4px
short. The POS is unaffected — its controls set `min-h-11` explicitly.

Parked as a `test.fixme` in `e2e/accessibility.spec.ts` with the reasoning inline. Un-skip it once
the call is made. It is a design-system decision, not a test one: `design-system.mdc` forbids
editing `components/ui/` primitives, so it is either a global `h-10 → h-11` (moves every button in
the app) or `min-h-11` on each call site.

### 4.2 E2E gaps that need infrastructure first
- **StaffRole enforcement** (a CASHIER refused an OWNER-only write) — untestable because there is
  no staff-management API to create a non-owner member.
- **CSV export contents** — the PII rule says last-4 phone only and DD/MM/YYYY IST, both untested,
  because the route is PRO-gated and nothing can upgrade a plan from a test.

### 4.3 Confirm CI actually runs e2e on `main`
`e2e/public.spec.ts` asserted a pricing tier that had been deliberately cut, so it had been failing.
Fixed in `433164c`. If CI was green through that period, the Playwright job is not gating `main` —
worth checking `.github/workflows/ci.yml` actually runs and blocks on it.

---

## 5. Ops

- **`AUTH_URL` is unset on Vercel.** Reset links are correct anyway via the
  `VERCEL_PROJECT_PRODUCTION_URL` fallback, but Auth.js also uses `AUTH_URL` for callback URLs.
  Set it to `https://awaazos.intelliforge.tech`.
- **Vercel CLI is not authorized locally.** `vercel --prod` fails with "Not authorized"; deploys
  currently happen via the GitHub integration on push to `main`. Run `vercel login` if CLI deploys
  or `vercel env pull` are wanted.
- **`.env` holds production credentials and is read by both Prisma and Next.** Never run
  `npm run e2e` against it — the suite registers vendors and rings up sales. Throwaway-Postgres
  recipe is in `CLAUDE.md`.
