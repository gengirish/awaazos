# TODO

Open items with enough context to act on months later. Ordered by *what breaks if we ignore it*,
not by effort.

Each item states the claim at risk, where the code is, and how to prove it one way or the other.
An item is only done when the verification step has actually been run — not when the code looks
right.

---

## 1. Claims we make publicly that may not be true

### 1.1 WhatsApp receipts may never be delivered

**Status:** unverified in production. Read from code, never observed working end to end.

The receipt is the third pillar of "speak → UPI QR → WhatsApp receipt" and it appears in the
pitch, the demo script and the marketing copy. Four independent gates sit in front of a message
actually arriving, and any one of them is sufficient to mean it never does:

1. **Plan gate.** `whatsappReceipts: false` on FREE (`lib/constants.ts`). The Hyderabad design
   partners are on FREE, so none of them have ever received one.
2. **Enqueue.** Needs `REDIS_URL` set on Vercel. On the automatic post-sale path the enqueue
   failure is logged and swallowed on purpose — correct (a Redis outage must never block a sale),
   but it means a misconfiguration is invisible. `POST /api/receipts/send` at least returns 503.
3. **Worker.** `workers/receipt.worker.ts` has to be running on Fly to drain the `send-receipt`
   queue. Not confirmed.
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
One line in `formatWhatsAppReceiptMessage` (`lib/whatsapp-message.ts`) — the body currently ends
at "Powered by AwaazOS" and carries no way back to the vendor. This is the market-sale → repeat
loop in miniature. Blocked behind 1.1 being true.

### 3.2 Tap-to-compose WhatsApp order on the storefront
Buyer taps items on `/s/[slug]`, the page composes a pre-filled WhatsApp message to the vendor.
Buyer never leaves WhatsApp; vendor stops parsing prose out of a group chat. Also the compliant
path — a customer-initiated message opens the 24-hour window legitimately, so no templates and no
consent apparatus are needed.

### 3.3 `fssaiNumber` on storefront and receipts
Home food businesses must show an FSSAI registration number on packaging, invoices and digital
menus. Same shape as the existing `gstin` / `hsnCode` fields. Makes a seller compliant as a side
effect of using us. Confirm the current rule for home-scale operators before putting it in a pitch.

### 3.4 The real project, if discovery passes
Orders placed remotely with a paid/unpaid state, a customer entity (today a buyer is just a phone
number stamped on a transaction), and order cut-off times for batch cooking. `razorpayLinks` is
currently a flag in `PLAN_LIMITS` with no implementation behind it.

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
