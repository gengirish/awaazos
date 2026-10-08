# PWA plan: offline counter sales

Written 2026-10-07 against `chore/cleanup-phase-0-1` at `2d3db5c`.

**Progress (2026-10-07):** Phases 0–2 are implemented in the working tree (uncommitted), along with
the Phase 3 header items. D1–D5 are decided as recommended. Still open: the install prompt, the
Lighthouse audit, the ARCHITECTURE.md ADR and the runbook, and **`npx prisma db push` against Neon
before deploying**. The route writes `Transaction.clientRef`, so production will 500 on every sale
until that column exists.

## Where we were

AwaazOS was installable but not offline-capable:

- `app/manifest.ts` serves a standalone manifest (`start_url: "/pos"`, maskable icons). It was added so
  iPhones can receive Web Push.
- `public/sw.js` handled push and `notificationclick` only, with no `fetch` handler.
- The worker was registered only from `lib/push-client.ts`, i.e. when a vendor touched push alerts.

With no network, `/pos` didn't load at all. If the network dropped mid-shift, checkout failed with a
toast and the sale was lost unless the vendor remembered it.

## Goal

A vendor at a stall with patchy 4G can keep ringing up **counter sales** offline, and they sync to
Postgres automatically and exactly once when the network returns. Nothing else goes offline.

**Out of scope:** storefront, drops, the orders boards, analytics, menu editing and settings. All of
these need live data or other people's writes. They get a static "You're offline" page instead.

## What works offline and what doesn't

| Piece | Offline? | Why |
|---|---|---|
| Tap input (`QuickAddGrid`) | Yes | Pure client state (`lib/cartStore.ts`, zustand) |
| Voice | **No** | Chrome's Web Speech is server-side ASR, and `/api/ai/*` needs the network. Offline, the mic is disabled with the label "Voice needs internet — tap items below". |
| UPI QR | Yes | Rendered locally by `lib/qr.ts` (was `api.qrserver.com`) |
| Cash sale | Yes | Queued in IndexedDB, synced later |
| UPI sale | Yes, `PENDING` unless a UTR is typed | The buyer's phone pays over its own network. We can't confirm it, which was already true. |
| Bill number `AWZ-YYYYMMDD-NNNN` | Assigned at sync | "Offline #N" until then (D2) |
| WhatsApp receipt | After sync only | The receipt modal hides the wa.me button for a queued sale. The vendor can resend it from `/transactions` once it has synced. |
| Today's revenue header | Server figure + local pending | Shown as "incl. ₹X not yet synced" |

## Decisions (resolved 2026-10-07, all as recommended)

| # | Question | Decision |
|---|---|---|
| D1 | Service worker: hand-written or Serwist? | Hand-written. It keeps `sw.js` as plain JS with no build step. |
| D2 | Offline bill numbers | Assigned at sync. The device shows "Offline #N" until then. |
| D3 | Offline sale syncs after `monthlyTxnCap` | Accepted and logged as `offline_sale_over_cap`. Live checkouts stay blocked (402). |
| D4 | Oldest deferred sale accepted | 7 days (`MAX_DEFERRED_SALE_AGE_MS`). Older ones get a 422 and stay on the device as "couldn't sync". |
| D5 | Offline UPI or cash only | Both |

## Verification

```bash
npm test && npm run typecheck && npm run lint && npm run build
rg -l "toFixed" --glob '!lib/upi.ts' --glob '!*.md' app/ components/ lib/ workers/ hooks/
```

Playwright runs against a throwaway Postgres, never production (see CLAUDE.md "E2E writes real
rows"). The offline flow is `e2e/pos-offline.spec.ts` (Chromium only: service workers plus
`context.setOffline`).

---

## Phase 0: Fixes worth doing even without offline mode — done

- [x] **The POS now sends an `Idempotency-Key`.** Every checkout gets a `clientRef` uuid, which is
      sent as the key and is also the durable dedupe key (Phase 2).
- [x] **The UPI QR is generated locally.** `lib/qr.ts` (`qrcode` package) renders an SVG data URL on
      the server for `/s/[slug]` and `/s/[slug]/o/[token]`, and in the browser for `UpiQRModal` and
      onboarding (`hooks/useQrDataUrl.ts`). `buildQrUrl` is gone. `api.qrserver.com` has been removed
      from CSP `img-src`, `images.remotePatterns` and the e2e stubs, and
      `e2e/security-headers.spec.ts` now asserts it stays out.
- [x] **`/sw.js` is registered on POS load** (`lib/sw-client.ts`, called from `PosShell`). It uses the
      same URL and scope as push. Notification permission is still requested only on opt-in.

## Phase 1: Offline-capable app shell — done

- [x] `sw.js` `fetch` handler:
  - `/_next/static/**` and the icons are **network-first** with the cache as fallback. Cache-first
    would serve stale code under `next dev`, where chunk URLs aren't hashed. In production the chunks
    are `immutable`, so "network" is the HTTP cache and costs nothing.
  - Navigation to `/pos` is network-first, falling back to the last cached `/pos`. When the page is
    stored, every `/_next/static` URL in its HTML is cached too. Without that, the first visit's
    chunks (loaded before the worker controlled the page) would be missing offline.
  - Any other navigation goes to the network, falling back to `public/offline.html`, which is
    precached at install.
  - Never intercepted: `/api/**`, `/s/**`, non-GET requests and other origins.
- [x] Caches are versioned (`awz-static-v1`, `awz-pos-v1`), `activate` deletes old `awz-*` caches,
      and the static cache is capped at 400 entries.
- [x] **Tenant safety:** there is no staff sign-out UI to hook into. Instead, the worker drops
      `awz-pos-*` on any navigation to `/sign-in` or `/sign-up`, and whenever `/pos` answers with a
      redirect, 401 or 403.
- [x] `offline.html` is allowlisted in `middleware.ts` and `lib/auth.config.ts`.
- [x] Offline banner (`PosSyncStatus`): text and icon, `aria-live="polite"`, "Menu as of <time>".
      The time comes from the server render, passed in as the `renderedAt` prop.
- [x] Voice button: disabled offline, with the text "Voice needs internet — tap items below".
- ~~Menu copy in IndexedDB~~: dropped. The cached `/pos` HTML already carries the menu it was
  rendered with, and "Menu as of" makes its age visible.

## Phase 2: Offline sales queue and sync — done

### Server (`POST /api/transactions`)

- [x] `Transaction.clientRef String?` with `@@unique([vendorId, clientRef])`. **`prisma db push` is
      still needed on Neon.**
- [x] Body: optional `clientRef` (uuid), `clientCreatedAt` (ISO), `vendorId` and `deferred`.
- [x] An existing `clientRef` returns the original bill with **200**. A concurrent `P2002` is caught
      and answered the same way.
- [x] `vendorId` in the body must match the resolved vendor, or the server returns **404**.
      `requireVendorRole` silently falls back to the first membership when `?vendor=` doesn't match,
      so without this check a queued sale could land in another tenant.
- [x] `resolveSaleTime()` (`lib/transaction-post-body.ts`): a deferred sale uses `clientCreatedAt`
      for the IST day, bill number, `BillSequence`, `DailySummary`, `createdAt` and `paidAt`. It
      allows 5 minutes of future skew and rejects anything older than 7 days (422). Live checkouts
      still use the server clock.
- [x] Cap per D3.

### Client

- [x] `lib/pos-outbox.ts` (`idb-keyval`, database `awaazos-pos`, keys `sale:<vendorId>:<clientRef>`).
      Every checkout writes to the outbox first, then POSTs with an 8 s timeout. A success removes the
      entry. A network error, 5xx, 409 or 429 keeps it as "Offline #N". A live 4xx such as the plan
      cap removes it and shows the error, as before.
- [x] Sync is event-driven only: page load, `online`, tab visible, and after a successful sale. There
      is no interval timer. The drain is single-flight per vendor, oldest first, and sends
      `?vendor=` plus the body `vendorId` from the entry.
- [x] Response handling: 2xx removes the entry. 401 or 404 stops the drain and shows "Sign in again
      to sync". Other 4xx marks the entry `failed`, shown in a "couldn't sync" list on the POS with a
      confirm-to-remove. 5xx or a network error stops the drain and retries on the next trigger.
- [x] Receipt modal for a queued sale: "Paid · saved offline · Offline #N", with no WhatsApp button.
- [ ] **Deferred:** Background Sync in `sw.js`. It would duplicate the outbox logic in plain JS, and
      iOS doesn't support it. The page-level triggers cover the stall-open case.
- [ ] **Deferred:** a "Sync now" warning on sign-out, because there is no staff sign-out UI yet. The
      outbox is keyed by vendor and survives sign-out, so it syncs on the next sign-in to that vendor.

### PII

- [x] Today's checkout sends no customer phone or name, so outbox entries hold items, totals,
      payment method and an optional UTR. Entries are deleted on sync. `failCode` stores a server
      error code only, and nothing in the outbox is logged.

## Phase 3: Polish

- [x] Header shows server revenue plus today's pending, labelled "incl. ₹X not yet synced".
- [ ] Install prompt (`beforeinstallprompt`) on `/pos` after the first sale, plus an iOS "Add to Home
      Screen" hint shared with the push opt-in copy.
- [x] CLAUDE.md: an offline section next to the Web Push paragraph.
- [ ] ARCHITECTURE.md ADR ("bill number at sync, sale day from the device") and a `docs/runbooks/`
      entry for reconciling "couldn't sync" sales.
- [ ] Lighthouse PWA audit on the production `/pos`.

## Tests

- Unit: `lib/__tests__/pos-outbox.test.ts` (status classification, IST pending sum, sync order),
  `lib/__tests__/transaction-sale-time.test.ts` (skew and age bounds, the IST midnight boundary),
  `lib/qr.test.ts`, and `lib/__tests__/push-sw.test.ts` (fetch handler against a fake Cache Storage).
- E2E: `e2e/pos-offline.spec.ts` covers the UI flow (offline reload, 3 queued sales, exactly 3 bills
  after reconnect) and the API contract (replay gives 200 with the same bill, a deferred sale from
  yesterday gets yesterday's bill date, a 422 outside the window, a cross-vendor 404).

## Risks

- **Stale prices offline.** The cart uses the menu from the cached page. That is acceptable because
  the server already snapshots client-sent prices into `OrderItem`, and the banner shows the menu's
  age.
- **Clock skew.** `clientCreatedAt` comes from the device, bounded at +5 minutes and −7 days. Bill
  numbers stay server-assigned.
- **Cached tenant HTML on shared devices.** Covered by dropping the cache on sign-in and sign-up
  navigation and on redirects. There is no e2e test yet for "vendor A, then vendor B, then offline".
- **SW bugs brick the app.** The handler is small, `sw.js` is served `no-cache`, and the kill switch
  is in its header comment.
