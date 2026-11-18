# Domain move: awaazos.intelliforge.tech → awaazdo.store

Status: plan, 2026-11-18. awaazdo.store already serves the production deployment as an **extra host**
(Vercel, A `@` 216.150.1.1, `www` 308 → apex). Everything that builds a URL still uses
awaazos.intelliforge.tech.

## Where it stands (2026-11-18)

| Step | State |
| --- | --- |
| Phase 0: name cleared | **Done** 2026-11-18: owner confirmed "AwaazDo" is cleared. The rebrand (#203) is on `main`. |
| Phase 1 code (#223) | **Merged** 06:13 UTC. `lib/canonical-host.ts` (production hosts incl. awaazdo.store for the e2e guard, redirect rule), `components/shell/MovedHostNotice.tsx`. Off: `CANONICAL_HOST` unset, the old host still answers `/s/zz-probe` with 404, not a redirect. |
| `www.awaazdo.store` CNAME | **Done.** GoDaddy `www` → `cname.vercel-dns.com.`; Vercel shows it configured; `https://www.awaazdo.store` → 308 → `https://awaazdo.store/`. |
| Razorpay partner app redirect URI | **Blocked.** Save returns **403** (`POST /merchant/api/live/oauth/applications/…`) for both Development and Production. The form and owner role are fine; likely the new domain must be approved on the account first. Read the 403 response body, or ask Razorpay support. Tip: a comma turns a URI into a chip; Enter submits the form. |
| Razorpay partner app test webhook | Already points to `https://awaazdo.store/api/webhooks/razorpay-partner` (no live webhook). |
| Razorpay merchant website change | **Not started.** Probably needed before the redirect URI saves. |
| Phase 2 dry run | **Not started.** |
| Phases 3 and 4 | **Not started.** Phase 0 is clear; next gates are the Razorpay redirect URI and the Phase 2 dry run. |

## Phase 0: gate (decide before any step below)

1. **Cleared 2026-11-18** (owner confirmed). Background: the 2026-11-13 trademark check found Awaaz De Infosystems' registered
   class 42 marks "Awaaz.De" (3448631, 2380087), the same field (voice software). awaazdo.in uses the exact
   name. Moving the domain puts "awaazdo" in every link sellers print, post in bios and send to buyers. If
   the name changes later, all of that has to move a second time. Get a lawyer's opinion, or choose a new
   name, **before Phase 3**. Phases 1 and 2 are safe to do now, because no seller sees them.
2. **Keep intelliforge.tech registered forever.** Printed QR codes, Instagram bios, WhatsApp messages,
   story images and sent emails already carry the old host. The old host has to keep redirecting for as
   long as any of those are around. In practice that means for good.
3. **Pick the final host form:** apex `awaazdo.store` (recommended, since it's shorter on a story card) or
   `www`. The rest of this plan assumes the apex.

## What is tied to the host (found in the code)

| Thing | Where | What happens on a move |
| --- | --- | --- |
| Base URL for every generated link | `AUTH_URL` → `NEXT_PUBLIC_APP_URL` → `VERCEL_PROJECT_PRODUCTION_URL` (`appBaseUrl()` in `lib/storefront-razorpay.ts`, `lib/customer-auth.ts`, `app/api/auth/forgot-password/route.ts`, `workers/receipt.worker.ts`) | Change the env vars and **redeploy**. `NEXT_PUBLIC_*` is fixed at build time. Also `fly.toml` `NEXT_PUBLIC_APP_URL`. |
| Seller and buyer sessions | Auth.js cookies are host-only | Everyone signs in again on the new host. The `awz_vendor` cookie is set again on its own. |
| Razorpay Connect (OAuth) | `oauthRedirectUri(appBaseUrl())`, whitelisted on the partner app | Add the new callback to the whitelist **before** changing `AUTH_URL`. Keep the old one during the sunset. |
| Razorpay webhooks | `/api/webhooks/razorpay` (subscriptions), `/api/webhooks/razorpay-partner`, `/api/webhooks/razorpay-orders/[vendorId]` (pasted by sellers into **their own** dashboards) | Webhook senders don't reliably follow redirects. The old host must keep **serving** `/api/webhooks/**` with no redirect, and that never ends: you can't edit a seller's dashboard. |
| Razorpay account website | Platform merchant KYC and each connected seller | The registered website should match the live domain. A website change goes through Razorpay review, so start it early. |
| Seller app and per-store buyer apps (PWA) | `app/manifest.ts`, `/s/<slug>/manifest.webmanifest`, `/sw.js` | Installs belong to one origin and can't be moved. After a redirect, an old Home Screen app opens a browser tab. Sellers reinstall. Buyers reinstall a store app only if they want it. |
| **Offline counter sales** | IndexedDB outbox `awaazos-pos` (`lib/pos-outbox.ts`), per origin | Sales queued on the old origin are **stranded** if `/pos` redirects before they sync. Sync runs on `/pos` load, so the old host has to keep serving `/pos` for at least 7 days (`resolveSaleTime` refuses deferred sales older than that). |
| Push alerts | Subscriptions are stored on the server. The service worker belongs to its origin. | Pushes still arrive through the old origin's worker. A tap opens an old-host URL, which then redirects. Turning alerts on again on the new host adds a second device row, so expect two pings until the old row expires or is removed. |
| Buyer "recent orders" | localStorage (`components/storefront/recent-orders.ts`) | Lost on the new origin. Order links (`/s/<slug>/o/<token>`) still work through the redirect. |
| Story and share images | Use `req.nextUrl.host` | They pick up the new host on their own once sellers use it. |
| Copy and share buttons | `window.location.origin` / `.host` | Same: they follow whichever host the seller is on. |
| Hard-coded host | `scripts/render-pain-reels.ts` `SITE`, `components/admin/CommunityMembers.tsx` placeholder, `lib/drop-story-image.tsx` comment, tests (`community`, `referral`, `store-app`, `outreach-message`, `demo-claim-email`, `*-story-image`, `e2e-safety`) | Update in the Phase 1 PR. |
| **E2E production guard** | `e2e/helpers/safety.ts` `PRODUCTION_HOSTS` | **Add `awaazdo.store` and `www.awaazdo.store` now.** Today the e2e suite would run against the new production host, and its specs create vendors. |
| Support email | `components/legal/SupportEmailLink.tsx` (`contact@intelliforge.tech`), mobile-sweep baseline | Optional. Keep it unless mail is set up on awaazdo.store (MX, SPF, DKIM). The legal entity stays IntelliForge Digital Services. |
| Outgoing email | AgentMail inbox (`AGENTMAIL_INBOX_ID`) | Links in emails follow `appBaseUrl()`. Sending from an @awaazdo.store address is a separate, optional step. |
| SEO | No `metadataBase`, robots or sitemap today | Add Google Search Console for awaazdo.store and file a Change of Address once the site-wide 308 is live. |
| Docs | `docs/runbooks/*`, `docs/OBSERVABILITY.md`, `docs/RAZORPAY_PARTNER_PLAN.md`, `docs/DEMO_GUIDE.md`, CLAUDE.md | Update in the cutover PR. Leave `docs/archive/` alone. |

Not tied to the host: Neon, Upstash, BullMQ, Blob URLs, UPI deep links, bill numbers, the `awz_` cookie
names, the IndexedDB name and the manifest `id`.

## Phase 1: prepare (code only, no visible change)

One PR, safe to merge now:

1. **`e2e/helpers/safety.ts`:** add the new production hosts, with a test in `lib/__tests__/e2e-safety.test.ts`.
2. **Host-aware redirect, off by default.** Use the Next middleware (or `next.config.mjs` `redirects` with
   `has: [{ type: "host" }]`), driven by `CANONICAL_HOST`. Unset means no change. When it's set and the
   request host is a legacy host:
   - Leave these alone: `/api/**` (webhooks, offline outbox POSTs, crons, health, ready, push), `/sw.js`,
     `/offline.html`, the manifests and icons. A cross-origin redirect on a POST from an old-origin PWA
     fails CORS and drops the sale.
   - Phase-gate `/pos` through a second flag, `LEGACY_HOST_REDIRECT_POS`, so the old host keeps serving it
     until outboxes drain.
   - Everything else gets a 308 to `https://awaazdo.store` with the same path and query (`?src=ig`,
     `?ref=`, `?callbackUrl=`, magic-link tokens).
   - Don't add a Vercel domain-level redirect: it would redirect webhooks too.
3. **"We've moved" banner** for seller pages served on a legacy host (`/home`, `/pos`, `/orders`), behind
   the same flag. It says: open awaazdo.store, sign in, and add the app to your Home Screen again. On
   `/pos`, show it only when the outbox is empty.
4. Replace hard-coded hosts in scripts, placeholders and tests with `appBaseUrl()` or a fixture constant.
5. Docs: this file, plus a line in CLAUDE.md "Deploy topology".

**Built (branch `feat/domain-move-prep`):** items 1, 2, 3 and 5.
- `lib/canonical-host.ts` holds the host lists and the redirect rule. The middleware runs it first in
  `authorized()` (`lib/auth.config.ts`), so a signed-out visitor on the old host goes straight to the new
  `/sign-in` rather than the old one.
- The banner is `components/shell/MovedHostNotice.tsx`, rendered by `app/(vendor)/layout.tsx` on every
  seller page. While this phone still has queued sales, it asks the seller to stay online until they
  sync, and it doesn't offer the new link.
- Item 4 is dropped. The hosts in tests are input fixtures (link parsing, story text), and those inputs
  stay valid after the move. Change the reels script `SITE` and the community placeholder in the 3a PR.

Outside the code (user):

- Vercel: fix `www.awaazdo.store`. The CNAME still points at GoDaddy's `awaazdo.store.`; set it to the
  value Vercel shows.
- Razorpay partner app: **add** `https://awaazdo.store/api/vendor/payments/razorpay/callback` to the
  redirect URIs (keep the old one). Type a comma to make it a chip, then press Save (Enter submits the form).
- Razorpay merchant account: start the website change request, adding the new domain.

## Phase 2: dry run on the new host (2–3 days, test store only)

Use Sam Store (`sampreeti-store`) on `https://awaazdo.store`, with env still old:

- Sign up, sign in, sign out, password reset, buyer magic link. Today these may bounce to the old host
  because `AUTH_URL` points there. Write down what bounces: that list is what the env flip fixes.
- Store page, product link, checkout, UPI and a ₹1 Razorpay payment on the new host.
- Install the store app and the seller app from the new host. Turn alerts on and check that a push arrives.
- Counter sale, offline sale, then reconnect.

Then deploy to production with `CANONICAL_HOST` still unset, but with `AUTH_URL` and `NEXT_PUBLIC_APP_URL`
set to `https://awaazdo.store` on a **throwaway Vercel preview project or locally**, never on the live one.
Check that signing in on the old host lands the user signed in on the new one, and that no redirect loop
happens. This is the riskiest Auth.js behaviour, so test it before the real flip.

## Phase 3: cutover (only after Phase 0 clears)

### 3a. Soft move (day 0 → day 14)

One deploy:

1. Vercel env (Production): `AUTH_URL` and `NEXT_PUBLIC_APP_URL` = `https://awaazdo.store`, and
   `CANONICAL_HOST=awaazdo.store`, with `LEGACY_HOST_REDIRECT_POS` unset. Redeploy: env changes need a build.
2. Vercel Domains: make awaazdo.store the primary. Keep awaazos.intelliforge.tech and awaazos.vercel.app
   attached.
3. Razorpay: change the partner app webhook to `https://awaazdo.store/api/webhooks/razorpay-partner` and
   the platform subscription webhook to `/api/webhooks/razorpay`. Both hosts serve these routes, so order
   doesn't matter.
4. `fly.toml` `NEXT_PUBLIC_APP_URL`. The worker app isn't deployed (TODO.md 1.1), so this is a file edit.

What users see: links in new emails, receipts, referral links, claim links, Settings → Payments webhook URL
and the store link all show awaazdo.store. On the old host, every page except `/pos` redirects and API
calls keep working. `/pos` on the old host still works and shows the banner.

Message to sellers (WhatsApp and email, on day 0):

> AwaazOS has a new address: **awaazdo.store**. Your store link is now awaazdo.store/s/<your-link>. Old links
> and printed QR codes keep working, so nothing breaks. Please: (1) open awaazdo.store and sign in,
> (2) add it to your Home Screen again and delete the old icon, (3) turn order alerts on again, (4) change
> the link in your Instagram bio when you can. If you pasted a Razorpay webhook yourself, it keeps working.
> You don't need to change it.

Buyers don't need to do anything.

Watch on day 0 and day 1: production probes on both hosts (`/s/zz-probe` → 404,
`/api/auth/store-handle?handle=zz-probe`), Vercel runtime errors, a real ₹1 Connect payment,
`storefront_rzp_*` logs, and that trial-reminder emails link to the new host.

### 3b. Hard move (day ≥ 14, once no seller has opened `/pos` on the old host for 7 days)

Set `LEGACY_HOST_REDIRECT_POS=1`. From then on, every page on the old host redirects. APIs, webhooks and
PWA files keep being served there.

## Phase 4: sunset (day 14 → day 90, and the parts that never end)

- **Day 30:** list the vendors with a hand-pasted per-store webhook secret and ask each to update the URL.
  Keep serving the old one regardless.
- **Day 30:** remove duplicate push device rows for vendors who turned alerts on again on the new host.
- **Day 90:** remove the old Razorpay OAuth redirect URI, but only if logs show no Connect callback on the
  old host for 30 days.
- **Forever:** the old host stays attached on Vercel as a redirect plus `/api/**`, and intelliforge.tech
  stays renewed. Leave `e2e/helpers/safety.ts` listing both hosts.

## Rollback

At any point, unset `CANONICAL_HOST`, set `AUTH_URL` and `NEXT_PUBLIC_APP_URL` back to the old host,
redeploy, and make the old domain primary again in Vercel. Both hosts stay attached the whole time, so
nothing has to propagate through DNS. Sellers who installed from the new host keep that install. It still
works, because the new host keeps serving.

## Checklist

- [x] Phase 0: name cleared (owner confirmed, 2026-11-18)
- [x] Phase 1 PR merged (e2e guard, redirect behind a flag, banner; constants dropped), #223, 2026-11-18
- [x] `www` CNAME fixed (2026-11-18)
- [ ] New Razorpay redirect URI whitelisted (save returns 403)
- [ ] Razorpay website change filed
- [ ] Phase 2 dry run passed, including the Auth.js old-host sign-in check
- [ ] 3a env flip and redeploy; primary domain swapped; Razorpay webhooks moved; sellers messaged
- [ ] 3b `/pos` redirect on
- [ ] Day 30: per-store webhook owners asked; push duplicates removed
- [ ] Day 90: old OAuth redirect URI removed
