---
name: awaazos-testing
description: Testing conventions for AwaazOS — Vitest unit tests (node, plus opt-in DB integration files) + Playwright E2E. Use when adding tests for any new route, lib helper, component, or worker.
---

# AwaazOS Testing

## Stack

- **Vitest** (`vitest.config.ts`) — `environment: "node"`, picks up `**/*.test.ts`
  only, `@/` → repo root, no `setupFiles`. Pure-function and mocked-dependency
  unit tests in `lib/__tests__/` (plus `lib/currency.test.ts` and `lib/upi.test.ts`).
  There is **no DOM and no component testing**: `@testing-library/react` and
  `jsdom` are not installed, and `.tsx` test files would not be collected. Test
  UI through Playwright, or move the logic into a `lib/` helper and unit-test that.
- **Vitest DB integration** — opt-in `lib/__tests__/*.db.test.ts` files (see
  "Test database" below). Skipped in `npm test` and CI.
- **Playwright** (`e2e/*.spec.ts`) — everything that needs a real session:
  route auth, tenant isolation, plan gates, the POS flow, storefront, a11y checks.
- **Golden suites** (`tests/golden/`) — live LLM/ASR regression runs, excluded
  from `npm test`; only their offline validators run in CI.
- **Accessibility** — `e2e/accessibility.spec.ts` asserts tap-target sizes,
  live regions, skip links and labels. No automated axe audits:
  `@axe-core/playwright` is _not_ installed.

## Mandatory test coverage

| Area | Test type | Why |
|---|---|---|
| `lib/currency.ts` | Vitest unit (`lib/currency.test.ts`) | Money math is irreversible — see `.cursor/rules/money.mdc` |
| `lib/upi.ts` | Vitest unit (`lib/upi.test.ts`) | Wrong UPI deep-link = customer pays wrong vendor |
| Every protected API route in `app/api/**` | Playwright (`e2e/`) | Auth + tenant scoping must be enforced against a real session |
| Cross-tenant access | Playwright (`e2e/tenant-isolation.spec.ts`) | 404-not-403 on forged IDs |
| Plan gates | Playwright (`e2e/plan-gates.spec.ts`) | 402 body shape and gate ordering |
| Voice parser (`/api/ai/parse-order`) | Vitest with a mocked client (`lib/__tests__/anthropic.test.ts`) + the live golden suite | The 6 baseline transcripts in `.cursor/rules/voice-ai.mdc` |
| `BillSequence` | Playwright (`e2e/pos-transaction.spec.ts`) | Bill-number format, same-day increment, tampered totals, idempotent replay |
| POS happy path | Playwright (`e2e/pos-ui.spec.ts`) | Tap → cart → collect payment → mark paid → receipt |
| Sign-in / sign-up | Playwright (`e2e/auth-flows.spec.ts`) | Auth.js v5 wiring (Suspense bailout, Credentials flow) |

## Tenant isolation tests — REQUIRED for every protected route

Add them to `e2e/tenant-isolation.spec.ts`. Each test gets two vendors in two
browser contexts (`createVendorSession()` from `e2e/helpers/vendor.ts`, set up
in `beforeEach`):

```ts
test("vendor B cannot update or delete vendor A's menu item (404, not 403)", async () => {
  const itemA = await createMenuItem(pageA, { name: "A Secret Samosa", priceInRupees: 15 });

  const patch = await pageB.request.patch(`/api/menu/${itemA.id}`, {
    data: { name: "hijacked" },
    headers: { "Content-Type": "application/json" },
  });
  expect(patch.status()).toBe(404);  // 404 not 403 — don't leak existence
});
```

## Money tests

```ts
expect(rupeesToPaise(20)).toBe(2000);
expect(rupeesToPaise(20.55)).toBe(2055);
expect(() => rupeesToPaise(20.555)).toThrow();        // 3 decimals invalid
expect(formatINR(2000)).toBe("₹20.00");               // the argument is paise
expect(formatINR(200_000)).toBe("₹2,000.00");
expect(formatINR(123456789)).toBe("₹12,34,567.89");   // lakh formatting
```

## BillSequence concurrency — NOT YET COVERED

`e2e/pos-transaction.spec.ts` checks sequential increments only; no test fires
concurrent `POST /api/transactions` and asserts unique bill numbers. If you add
one, follow the concurrency pattern already in `lib/__tests__/drops.db.test.ts`
(`Promise.all` over N writes, then assert the exact success count), either as a
Playwright spec (real session) or as a `*.db.test.ts` that calls the route
handler with `@/lib/rbac` mocked.

## Playwright happy path

Located at `e2e/pos-ui.spec.ts`. Covers:
1. Sign in as test vendor owner
2. Navigate to /pos
3. Click a QuickAddGrid item. Its accessible name is `"{name} {formatINR(price)}"` (e.g. `Samosa ₹15.00`) because the emoji span is `aria-hidden` — anchor the regex (`/^Samosa/`) so short names do not match longer ones. Skip the mic in CI: headless Chromium has no SpeechRecognition.
4. Click `Collect payment` — note the lowercase p; it is also the UpiQRModal dialog title, so disambiguate by role
5. Verify UPI QR renders — `page.getByAltText("UPI payment QR code")` (equivalently `getByRole("img", { name: "UPI payment QR code" })`); there is no `data-testid` on it
6. Choose **Cash**, then `/Mark as paid/` (the accessible name carries a trailing ✓, so `{ exact: true }` fails)
   - The UPI path is **not** drivable for a freshly registered vendor: `/api/auth/register` never sets `upiId`, and `UpiQRModal` disables the button while `payMode === "UPI" && !effectiveUpiId`. Complete onboarding or `PATCH /api/vendor` first if you need to test UPI.
7. Verify the receipt shows a bill matching `/AWZ-\d{8}-\d{4}/`, then `/New order/` clears the cart
8. Verify totals server-side — see `e2e/pos-transaction.spec.ts` for the API-level bill-number, paise-total and tampering assertions

## Accessibility audit — NOT YET IMPLEMENTED

There are **no automated axe audits in this repo today**, and `@axe-core/playwright`
is **not installed** (the `axe-core` in `node_modules` is only a transitive dependency of
`eslint-plugin-jsx-a11y`). The measurable POS rules (tap-target sizes, live regions,
skip links, labels) are asserted by `e2e/accessibility.spec.ts`; the rest is enforced by
review + the `.cursor/rules` a11y conventions.

Do not write `injectAxe` / `checkA11y` calls until someone runs
`npm i -D @axe-core/playwright` and wires the suite into `npm run e2e`. Once that lands, the
intended shape is:

```ts
// requires: npm i -D @axe-core/playwright  (not installed yet)
import { injectAxe, checkA11y } from "@axe-core/playwright";

test("POS screen passes axe", async ({ page }) => {
  await page.goto("/pos");
  await injectAxe(page);
  await checkA11y(page, undefined, { detailedReport: true });
});
```

## Test database

- E2E needs a real, **throwaway** Postgres — never production (see `CLAUDE.md`). CI provisions `postgres:15-alpine` as a service and runs `npx prisma db push` before Playwright.
- Vitest has no global database setup: no `setupFiles`, no `vitest.setup.ts`, no `TEST_DATABASE_URL`. Regular `lib/__tests__/*.test.ts` files are pure-function or mocked-Prisma tests.
- The exception is the opt-in `lib/__tests__/*.db.test.ts` files (drops, menu-orders, storefront-orders, push, push-routes, storefront-razorpay). Each one:
  - is wrapped in `describe.skipIf(!ENABLED)` on an env flag — `DROPS_DB_TEST=1` (`npm run test:drops:db` runs that group) or `RAZORPAY_DB_TEST=1` — so `npm test` and CI skip it;
  - imports Prisma-touching modules lazily in `beforeAll`, and refuses to run unless `DATABASE_URL` points at `localhost` / `127.0.0.1`;
  - seeds uniquely tagged vendors and deletes them in `afterAll` (there is no per-test transaction rollback);
  - when it calls route handlers directly, mocks `@/lib/rbac` (`requireVendorRole`) and external services (`web-push`, or global `fetch` for Razorpay);
  - documents its docker + `prisma db push` setup in its header comment.
- E2E specs isolate themselves by registering a uniquely-suffixed vendor per test (`registerVendor()` in `e2e/helpers/vendor.ts`).

## CI

`.github/workflows/ci.yml`, three jobs:

- **quality** — lint → typecheck → vitest → build
- **e2e** — needs `quality`. Provisions a `postgres:15-alpine` service, runs `npx prisma db push`, installs chromium, then `npm run e2e`. Playwright starts `npm run dev` itself via `webServer` in `playwright.config.ts` — it does **not** run against a Vercel preview URL. Set `BASE_URL` to aim a run at a deployed environment instead.
- **security** — gitleaks full-history scan + `npm audit --audit-level=high`
