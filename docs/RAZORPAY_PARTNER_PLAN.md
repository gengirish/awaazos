# Razorpay Partner (OAuth "Connect Razorpay") — plan

Status (30/10/2026): Technology Partner account **activated**. Remaining Razorpay
steps: (1) Integrate using OAuth, (2) Onboard merchants. No code written yet.

## Why

Today a seller who wants online payments must, in their own Razorpay dashboard,
generate API keys **and** create a webhook to
`/api/webhooks/razorpay-orders/<vendorId>` with a secret, then paste all three into
Settings → Payments (`components/settings/RazorpayKeysClient.tsx`,
`PUT /api/vendor/payments`). The webhook step is too hard for a home cook, and a
wrong secret fails silently (payment still lands via the browser `verify` call;
only the "buyer closed the tab" case breaks).

With a Razorpay Technology Partner OAuth app the seller taps **Connect Razorpay**,
approves on Razorpay, and is done. Money still settles into the seller's own
account — AwaazOS stays out of the flow of funds (not a payment aggregator).
**Never** use Razorpay's Aggregator / sub-merchant model for this. Commission on
connected sellers' volume comes with the partner programme; it changes nothing in
the money path.

## What Razorpay's OAuth docs say (checked 30/10/2026)

Source: razorpay.com/docs/partners/technology-partners/onboard-businesses/integrate-oauth/integration-steps

| Item | Answer |
| --- | --- |
| Authorize | `GET https://auth.razorpay.com/authorize?client_id&response_type=code&redirect_uri&scope=read_write&state` — redirect URI must be whitelisted on the app |
| Token | `POST https://auth.razorpay.com/token` `{ client_id, client_secret, grant_type: authorization_code, redirect_uri, code, mode: test\|live }` — production clients may only ask for `live` |
| Token response | `access_token` (Bearer), `refresh_token`, `expires_in` (~90 days), `public_token` (`rzp_test_oauth_…` / `rzp_live_oauth_…`), `razorpay_account_id` (`acc_…`) |
| Refresh | same endpoint, `grant_type: refresh_token`. **Refresh tokens rotate**: the old one dies when a new one is issued. Refresh token lives 180 days |
| Revoke | `POST https://auth.razorpay.com/revoke` `{ client_id, client_secret, token, token_type_hint }` |
| API calls | `Authorization: Bearer <access_token>` instead of key id + secret |
| Checkout `key` | the `public_token` |
| Checkout signature | HMAC-SHA256 of `order_id\|payment_id`, but the docs disagree on the secret (`client_secret` vs key secret). **Don't depend on it** (see build step 5) |
| Revoke webhook | `account.app.authorization_revoked`, `account_id` at the top level |
| Payment webhooks for connected accounts | **Not confirmed in the docs.** An app-level webhook URL is set when the app is created; whether it gets `payment.captured` / `order.paid` for connected sellers must be checked in the partner dashboard |

## Step 1 — partner dashboard (user, with Claude in Chrome)

- [ ] Partner dashboard → Applications → create app "AwaazOS". **Test mode first.**
- [ ] Redirect URIs:
  `https://awaazos.intelliforge.tech/api/vendor/payments/razorpay/callback`
  (+ `http://localhost:3100/api/vendor/payments/razorpay/callback` if allowed).
- [ ] App webhook: `https://awaazos.intelliforge.tech/api/webhooks/razorpay-partner`.
      Record which events the form offers. We want `payment.captured`, `order.paid`,
      `account.app.authorization_revoked`. **This decides build step 6.**
- [x] Done 30/10/2026 (Claude in Chrome): app "AwaazOS", app id `Tu7LkJm0zfKSjm`.
      Separate credentials per environment: Development client_id `Tu7LkS5XB21QzW`
      (redirects: prod callback + localhost:3100 callback), Production client_id
      `Tu7LkjaOMTq8ZA` (prod callback only; must be HTTPS). Secrets are on the app page only.
      **The app webhook offers the full event catalogue, including `payment.captured`,
      `order.paid` and `account.app.authorization_revoked`**, so build step 6 takes the
      webhook branch. Webhooks are separate for Test and Live ("Manage Test/Live Webhook").
- [x] Test webhook created 30/10/2026: URL above, 3 events, secret set by the user.
- [ ] Live webhook: same URL, events and a new secret, at rollout step 2.
- [ ] User sets on Vercel (never pasted in chat): `RAZORPAY_OAUTH_CLIENT_ID`,
      `RAZORPAY_OAUTH_CLIENT_SECRET`, `RAZORPAY_PARTNER_WEBHOOK_SECRET`,
      `RAZORPAY_OAUTH_MODE` (`test` until rollout step 2).
- Do **not** touch the platform subscription webhook (`/api/webhooks/razorpay`,
  `subscription.*` events) or the platform `RAZORPAY_*` keys.

## Step 2 — build (Claude Code, own worktree — see memory "parallel sessions")

**Built 30/10/2026** on `feat/razorpay-connect`, migration `20261030000000_razorpay_oauth`.
Differences from the list below: there is no `razorpayConnectMode` / `razorpayOauthMode`
column. The method is "OAuth columns set" and the mode comes from the public token's
prefix. `razorpayAccountId` is indexed, not unique, because one Razorpay account may run
several stores. `razorpayRefreshExpiresAt` was added so Settings can show "Reconnect".
Step 6 took the webhook branch, since the app webhook offers payment events. Went live
30/10/2026 with the Production credentials.

Follow-up (`feat/razorpay-connect-polish`): Razorpay refusals are surfaced in Settings
(`lib/razorpay-issue.ts`), and buyers are sent to UPI instead of "try again". There is
**no referral link**. A platform partner's dashboard has none; a seller without an account
signs up inside the Connect flow, which is Razorpay's co-branded onboarding (Applications →
AwaazOS → Onboarding UI Configurator: colour, logo, name). The 400/403 → "finish KYC"
reading is an assumption that still needs checking against a real unactivated account.

One PR, behind the env gate, so it can merge before any seller sees it.

1. **Env** (`lib/env.ts`): the four keys above, feature-gated, `requireEnv` lazily.
   The Connect button shows only when client id + secret + `PAYMENT_KEYS_ENCRYPTION_KEY`
   are set.
2. **Schema** (`VendorSettings`, beside `razorpayKeyId`): `razorpayConnectMode`
   (`KEYS` | `OAUTH`), `razorpayAccountId` (unique), `razorpayAccessTokenEnc`,
   `razorpayRefreshTokenEnc`, `razorpayTokenExpiresAt`, `razorpayPublicToken`,
   `razorpayOauthMode` (`test` | `live`). Tokens encrypted with `lib/secret-box.ts`,
   AAD per vendor and column. Committed migration under `prisma/migrations/`;
   **user runs `prisma migrate deploy` on Neon before the merge**.
3. **Connect flow**, OWNER + STARTER (same gate as `PUT /api/vendor/payments`):
   - `GET /api/vendor/payments/razorpay/connect` → `state` = vendorId + nonce + expiry,
     HMAC with `AUTH_SECRET`, also kept in a short-lived httpOnly cookie → 302 to authorize.
   - `GET /api/vendor/payments/razorpay/callback` → state matches cookie and is fresh →
     session user is still OWNER of **that** vendor (else 404) → exchange code →
     `razorpay_account_id` not already on another vendor (else `account_in_use`) →
     store encrypted tokens and set mode `OAUTH` → 302 `/settings/payments?connected=1`.
     Every failure (`access_denied`, bad state, exchange error) redirects with an
     error code. No JSON bodies, no token in logs.
   - `DELETE /api/vendor/payments`: in OAuth mode, call revoke (best effort), then clear
     the columns.
4. **Creds abstraction** in `lib/storefront-razorpay.ts`: replace `RazorpayCreds` with
   `{ auth: { kind: "basic", keyId, keySecret } | { kind: "bearer", accessToken }, checkoutKey }`.
   `createRazorpayOrder` / `fetchRazorpayOrder` build the header from it.
   `hasStoredRazorpayCreds` / `isOnlinePaymentEnabled` accept either mode. Call sites:
   `app/api/s/[slug]/orders/[token]/razorpay/route.ts`, `…/razorpay/verify/route.ts`,
   `app/api/vendor/payments/route.ts`, `app/(vendor)/settings/page.tsx`,
   `app/(vendor)/settings/payments/page.tsx`, `app/s/[slug]/o/[token]/page.tsx`.
5. **Verify without the checkout HMAC in OAuth mode.** The verify route fetches the
   Razorpay order with the Bearer token and marks paid only if it is `paid`, for the
   order's own amount, and is the `razorpayOrderId` on file. The server's read is the
   proof, so the signature doubt above doesn't matter. Keys mode keeps the HMAC.
6. **Payments when the buyer closes the tab:**
   - **If** the app webhook gets payment events: `app/api/webhooks/razorpay-partner/route.ts`.
     The secret is platform-wide, so HMAC is verified **before any DB read** (stricter
     than the per-vendor route). Then vendor by `razorpayAccountId`, then the per-vendor
     route's handling, extracted into a shared function (`markOrderPaid`, same 200/500
     rules, no body logging). The revoke event clears tokens.
   - **If not:** the partner webhook handles only the revoke event. Missed payments are
     settled **on read**: when the buyer's order page or the board loads an order that is
     unpaid with a `razorpayOrderId`, fetch that one order from Razorpay and run
     `markOrderPaid` if it is paid. This is event-driven on a page load. **No timer, no cron.**
7. **Token refresh on demand only.** When a buyer taps "Pay online" and the access token
   expires within 7 days (or a call 401s), refresh inside `SELECT … FOR UPDATE` on the
   VendorSettings row, re-reading after the lock. Refresh tokens rotate, so two
   concurrent refreshes would lock the seller out. A seller with no online order for
   180 days loses the refresh token. That's accepted: online pay is hidden, and Settings
   and the setup checklist show "Reconnect Razorpay".
8. **Settings UI** (`RazorpayKeysClient.tsx`): "Connect Razorpay" is the main button;
   "Use API keys instead" keeps today's form. The connected state shows `acc_…` and the
   test/live badge, not key last-4. Update `lib/help-guide.ts` and the setup checklist
   step's copy.
9. **Checkout label** (independent, can ship first): when online pay is enabled, call the
   option "Pay online (UPI, card, netbanking)".

## Step 3 — onboard merchants (Razorpay's third step)

A seller must have an **activated** Razorpay account (KYC done) before live payments work.

- Seller without a Razorpay account: under the Connect button, link "No Razorpay
  account? Sign up" using the partner referral link from the dashboard. That's what
  attributes the seller to us for commission.
- Seller authorised but KYC not finished: test whether creating a live order fails. If
  it does, map the error to "Finish activating your Razorpay account" in Settings and
  keep online pay hidden on the storefront, rather than letting a buyer hit an error.
- Founder outreach (`/admin/demo-stores` handover): add the "Connect Razorpay" step to
  the post-claim checklist. Demo stores never connect (`demo@upi` rule stands).

## Tests

- Vitest: state signing/expiry/tamper, token-response parsing, refresh decision
  (expiry window, 401), auth-header builder for both modes, partner-webhook HMAC before
  lookup, verify route accepting a server-confirmed paid order without a signature in
  OAuth mode (extend `storefront-razorpay.test.ts`, `razorpay-signature.test.ts`; DB cases
  in `storefront-razorpay.db.test.ts`, including two concurrent refreshes → one network call).
- Playwright: Connect button only when env is set; cross-tenant case in
  `e2e/tenant-isolation.spec.ts` (vendor B's session with vendor A's `state` → 404,
  nothing stored on A).

## Rollout

1. Test-mode app → connect Sam Store (`sampreeti-store`) → test order with
   `success@razorpay` → paid via verify. Then close the tab mid-payment and check that
   the order is still paid (webhook or on-read path).
2. Live app (`RAZORPAY_OAUTH_MODE=live`) → reconnect Sam Store → ₹1 order → refund.
3. Delete the per-store webhook added for Sam Store by hand (21/10/2026) in the AwaazOS
   Razorpay account. Keep the subscription webhook.
4. Keep the manual keys path; don't remove `/api/webhooks/razorpay-orders/[vendorId]`.
   Existing keys-mode sellers aren't migrated automatically. Settings offers "Switch to
   Connect Razorpay".

## Related

- Cashfree partner setup was started in parallel (21/10/2026); no Cashfree code. Plan it
  after this one, on the same creds abstraction.
