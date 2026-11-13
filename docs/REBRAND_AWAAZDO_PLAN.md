# Rebrand: AwaazOS → AwaazDo

Status: Step 1 built 2026-11-13 as a draft PR, **not to be merged until the name is cleared**. The Step 0
trademark check found conflicts: Awaaz De Infosystems holds class 42 marks "Awaaz.De" (voice/IVR software),
awaazdo.in is a pre-launch complaints platform, and Sony holds "Awaaz" in class 9. "AwaazDo" is therefore a
placeholder. The code reads the name from `lib/brand.ts`, so a different name is a one-line change there plus the
files that can't import it (`public/sw.js`, `public/offline.html`, `content/admin-nudges/*.txt`,
`e2e/mobile-sweep.baseline.json`). Prose docs keep "AwaazOS" until the name is final; only the tagline changed in them.

- **Name:** AwaazDo ("awaaz do": give a shout, call it out). It fits the product a seller uses now: they
  announce a drop and buyers come. "OS" came from the counter POS days.
- **Tagline:** "Banao. Batao. Becho." (Make it. Tell people. Sell it.) It replaces "Bol. Bill. Becho.". All three
  verbs are in the same form, so the line has a real rhyme and an even beat, and it covers kitchens and goods stores alike.

The rule for the whole change: **change what people read, keep every identifier a device or another system
already holds.** A renamed cookie, IndexedDB store, manifest `id` or webhook URL breaks sessions, offline sales,
installed apps or payments, and nobody gains anything from the new spelling.

## Size

543 mentions of `awaazos` in 221 tracked files (excluding `docs/archive/`): `lib` 152, `app` 102, `docs` 58,
`components` 41, `PITCH.md` 29, `README.md` 21, tests and e2e, plus `.cursor` rules. The tagline appears in 7 code
or rule files. Most of the code mentions are display strings.

## Step 0: checks before any code (founder)

1. **Trademark:** search IP India (classes 9, 35 and 42) and a plain web, Play Store and App Store search for
   "AwaazDo", "Awaaz Do" and "Awaazdo". Stop here if someone in commerce or software already uses it.
2. **Handles:** check Instagram, WhatsApp Business display name, X and YouTube for `awaazdo`.
3. **Domain:** see whether `awaazdo.in` and `awaazdo.com` are free and buy one only to *hold* it. Moving the app to
   it is a separate decision (Step 3).
4. **Icon:** check whether `public/icon-*.png`, `apple-touch-icon.png` and `badge-72.png` show the word "OS". If they
   do, they need redrawing. The आवाज़ logo mark stays.
5. Say "Banao. Batao. Becho." aloud to two or three sellers before committing to it.

## Step 1: one PR, the words (no domain change)

### 1a. One source for the name

Add `lib/brand.ts` (pure, client-safe):

```ts
export const BRAND_NAME = "AwaazDo";
export const BRAND_TAGLINE = "Banao. Batao. Becho.";
export const BRAND_SIGNOFF = `${BRAND_NAME} — ${BRAND_TAGLINE}`;
```

Every display string goes through it instead of a literal, so the next naming decision is a one-line change.
Add a unit test that fails if `AwaazOS` appears in `app/`, `components/`, `lib/` or `hooks/` outside the
"Keep" list below (the same idea as the `toFixed` check in CLAUDE.md).

### 1b. What changes

| Area | Files (main ones) | Note |
| --- | --- | --- |
| Tagline | `components/marketing/Hero.tsx`, `components/storefront/PoweredByFooter.tsx`, `app/s/[slug]/opengraph-image.tsx`, `lib/email.ts` (3 sign-offs), `components/analytics/AnalyticsDashboard.tsx` empty state | The empty state was a play on "bol bill becho". Rewrite it: "No sales yet. Banao, batao, becho!" |
| Page metadata | `app/layout.tsx` (`title`, `appleWebApp.title`), marketing page titles | |
| Installed app name | `app/manifest.ts` `name` / `short_name` | **Keep `id: "/"`.** Installed apps pick up the new name the next time Chrome refreshes the manifest. iOS keeps the name it was given when added until the app is re-added. That is fine. |
| Shell and marketing | `MarketingHeader`, `MarketingFooter`, `AppNav`, `CtaBanner`, `OnlinePayments`, `InstallGuideDialog`, `InstallPrompt`, `lib/install-app.ts`, `lib/install-prompt.ts`, `hooks/usePushAlerts.ts` | |
| Buyer-facing | `PoweredByFooter` ("Powered by AwaazDo"), `StorefrontCheckout` ("AwaazDo never holds your money"), `ReceiptDocument`, `UpiQRModal` fallback bill ref | |
| Payments | `BillingManageClient` Checkout `name`, `RazorpayKeysClient` copy | Checkout `name` is what a seller sees in the Razorpay window. |
| Push | `public/sw.js` fallback notification title | The `tag` stays (see Keep). |
| Help and settings | `lib/help-guide.ts`, `components/settings/sections.ts`, `VoiceAlertToggle`, `OwnerSurveyForm` | `help-guide.test.ts` must stay green. |
| Messages sellers send | `lib/outreach-message.ts`, `lib/referral-message.ts`, `lib/store-contact.ts`, `lib/delivery-handoff.ts` text, `content/admin-nudges/` | Pre-filled WhatsApp and email texts. |
| Admin | `lib/pricing-calculator.ts`, `components/admin/PricingCalculator.tsx` | Internal only, low priority. |
| Legal | `app/(marketing)/legal/{terms,privacy,refund,dpdp-rights}`, `components/legal/BusinessDetails.tsx` | Write "AwaazDo (formerly AwaazOS), a service of IntelliForge Digital Services". Keep "formerly" for at least a year: earlier sellers accepted terms under the old name. Change the legal pages' "last updated" date. |
| Password blocklist | `lib/password-strength.ts` | **Add** `awaazdo1`, `awaazdo123`, and keep the old ones. |
| Tests | ~25 `lib/__tests__` files that assert copy, `e2e/*` | Re-record `e2e/mobile-sweep.baseline.json` (9 hits). |
| Docs and rules | `README.md`, `PITCH.md`, `CLAUDE.md`, `AGENTS.md`, `ARCHITECTURE.md`, `TODO.md`, `docs/*` (not `docs/archive/`), `.cursor/rules/design-system.mdc` tagline rule | Edit `.cursor/`, then `npm run sync:agent-rules`. Never edit `.claude/` by hand. |
| Razorpay plan script | `scripts/razorpay-create-plans.ts` plan `name` | Affects **new** plans only. Existing Razorpay plans can't be renamed and stay "AwaazOS …" until the next price change creates new ones. That is acceptable. |

The voice prompts (`lib/anthropic.ts`, `parse-drop`, `parse-menu`) don't contain the name, so the prompt cache and
golden sets are not affected.

### 1c. Keep: identifiers that stay `awaazos` / `awz` on purpose

| Identifier | Why it stays |
| --- | --- |
| `awaazos-pos` IndexedDB store (`lib/pos-outbox.ts`) | A new name opens an empty outbox: queued offline sales would never sync. |
| `awz_vendor`, `awz_cust` cookies, `awz:` localStorage keys | Renaming them signs every buyer out and forgets carts, recent orders and device choices. |
| `AWZ-YYYYMMDD-NNNN` bill numbers | Already printed on bills and receipts; it still reads as "Awaaz". |
| `awaazos:push-arrived`, `awaazos:pos-outbox-changed` events, `sw.js` push `tag` | Internal. A cached old service worker and a new page have to agree on them. |
| Manifest `id: "/"` | Changing it makes every installed copy a different app. |
| `package.json` name, CI database `awaazos`, Fly apps `awaazos-workers` / `awaazos-whisper-stt`, `workers/sentry.ts` server name, `GUPSHUP_APP_NAME`, the GitHub repo name, the Vercel project name | Nobody outside sees them. Renaming means re-wiring deploys for nothing. |
| `VOICE // Via AI voice (AwaazOS core)` and other code comments | Optional; change them in passing, no need to hunt for them. |

### 1d. Checks for the PR

`npm test && npm run typecheck && npm run lint && npm run build`, `npm run perf:budget`, both E2E projects on a
throwaway Postgres, then the brand-literal test from 1a. No schema change, so no migration.

After merge, on production: the landing page, a store page and its share image (paste the link in WhatsApp), a
receipt `/r/…`, an email (claim link or trial reminder) and the installed app name on an Android phone.

## Step 2: outside the code (founder, same week as the PR)

- **Razorpay account display name** (Dashboard → Settings → Business). This is what sellers see on the UPI AutoPay
  mandate and on their bank statement. The legal name stays IntelliForge Digital Services.
- **Razorpay Partner app name** (the "Connect Razorpay" consent screen). It may need Razorpay's review: ask before
  changing, so Connect doesn't stop working while the review runs.
- **AgentMail** sender display name for the inbox in `AGENTMAIL_INBOX_ID`. Keep the address unless the domain moves.
- **WhatsApp Business** profile name for `NEXT_PUBLIC_SUPPORT_WHATSAPP` (WhatsApp reviews display name changes).
- **Instagram and other bios**, Google Search Console, the pitch deck and Canva assets.
- **Outreach texts outside the repo:** the `founder-demo-outreach` and `outreach-writer` skills and any saved
  templates.
- **One message to current sellers:** "AwaazOS is now AwaazDo. Your store link, orders and plan stay the same."
  Send it from `/admin/vendors` (wa.me / mailto, as now). Nothing is sent from the server.

## Step 3, later and only if wanted: a new domain

Recommendation: **ship Steps 1 and 2 on `awaazos.intelliforge.tech` and decide the domain afterwards.** A
different name on the same host costs nothing. A host move costs a lot, because everything below is tied to the
origin:

- store links in Instagram bios, printed QR codes, `/r/` receipts, `/d/` rider links and claim links already sent
- installed seller and buyer apps (an origin can't be redirected inside an installed PWA)
- push subscriptions and the service worker
- the `awz_*` cookies, so everyone is signed out
- Razorpay webhook URLs (platform, per-vendor and partner) and the OAuth redirect URI
- `AUTH_URL` / `NEXT_PUBLIC_APP_URL`, `fly.toml`, the cron routes and the AgentMail address

If the move happens: keep the old host serving the app for good, with no redirect for `/api/webhooks/**`, `/api/**`
and `/s/**`. Redirect only marketing pages, and mint new links on the new host. That is a plan of its own.

## Order

1. Step 0 checks. Stop if the trademark search finds a conflict.
2. Step 1 as one PR (about a day of work, mostly copy and test updates).
3. Step 2 in the days after merge.
4. Step 3 is undecided.
