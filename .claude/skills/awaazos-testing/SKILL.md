---
name: awaazos-testing
description: Testing conventions for AwaazOS — Vitest unit/integration tests + Playwright E2E. Use when adding tests for any new route, lib helper, component, or worker.
---

# AwaazOS Testing

## Stack

- **Vitest** — unit + integration (Prisma against test schema)
- **@testing-library/react + jsdom** — component tests
- **Playwright** — E2E for the POS happy path
- **Accessibility** — currently manual only (semantic roles, `aria-live`, chart `<details>` data tables). No automated axe audits: `@axe-core/playwright` is _not_ installed.

## Mandatory test coverage

| Area | Test type | Why |
|---|---|---|
| `lib/currency.ts` | Vitest unit | Money math is irreversible — see `.cursor/rules/money.mdc` |
| `lib/upi.ts` | Vitest unit | Wrong UPI deep-link = customer pays wrong vendor |
| Every API route in `app/api/**` | Vitest integration | Auth + tenant scoping must be enforced |
| Voice parser (`/api/ai/parse-order`) | Vitest fixtures | All 6 transcripts in `.cursor/rules/voice-ai.mdc` |
| `BillSequence` atomicity | Vitest concurrent | Race condition on bill numbers |
| POS happy path | Playwright | Mic → cart → UPI QR → mark paid → receipt |
| Sign-in / sign-up | Playwright | Auth.js v5 wiring (Suspense bailout, Credentials flow) |

## Tenant isolation tests — REQUIRED for every protected route

```ts
it("rejects cross-tenant access", async () => {
  const v1 = await createTestVendor("v1");
  const v2 = await createTestVendor("v2");
  const item = await prisma.menuItem.create({ data: { vendorId: v2.id, ...} });

  const session = await signInAs(v1.ownerUserId);
  const res = await fetch(`/api/menu/${item.id}`, { method: "PATCH", headers: session });

  expect(res.status).toBe(404);  // 404 not 403 — don't leak existence
});
```

## Money tests

```ts
expect(rupeesToPaise(20)).toBe(2000);
expect(rupeesToPaise(20.55)).toBe(2055);
expect(() => rupeesToPaise(20.555)).toThrow();        // 3 decimals invalid
expect(formatINR(2000)).toBe("₹2,000.00");
expect(formatINR(123456789)).toBe("₹12,34,567.89");   // lakh formatting
```

## BillSequence concurrency test

```ts
it("never produces duplicate bill numbers under concurrent writes", async () => {
  const vendor = await createTestVendor();
  const promises = Array.from({ length: 50 }, () =>
    fetch("/api/transactions", { method: "POST", body: JSON.stringify(SAMPLE), headers: session })
  );
  const results = await Promise.all(promises);
  const billNumbers = results.map(r => r.body.transaction.billNumber);
  expect(new Set(billNumbers).size).toBe(50);  // all unique
});
```

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

There are **no automated accessibility tests in this repo today**, and `@axe-core/playwright`
is **not installed** (the `axe-core` in `node_modules` is only a transitive dependency of
`eslint-plugin-jsx-a11y`). A11y is currently enforced by review + the `.cursor/rules` a11y
conventions, not by CI.

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

- E2E needs a real Postgres — a local one via Docker, or a separate Neon branch. CI provisions `postgres:15-alpine` as a service and runs `npx prisma db push` before Playwright.
- There is **no Vitest database setup**: `vitest.config.ts` declares no `setupFiles`, no `vitest.setup.ts` exists, and `TEST_DATABASE_URL` is referenced nowhere. Every test under `lib/__tests__/` is a pure-function or mocked-Prisma test.
- So there is no per-test transaction rollback either. E2E specs isolate themselves instead by registering a uniquely-suffixed vendor per test (`registerVendor()` in `e2e/helpers/vendor.ts`).

## CI

`.github/workflows/ci.yml`, three jobs:

- **quality** — lint → typecheck → vitest → build
- **e2e** — needs `quality`. Provisions a `postgres:15-alpine` service, runs `npx prisma db push`, installs chromium, then `npm run e2e`. Playwright starts `npm run dev` itself via `webServer` in `playwright.config.ts` — it does **not** run against a Vercel preview URL. Set `BASE_URL` to aim a run at a deployed environment instead.
- **security** — gitleaks full-history scan + `npm audit --audit-level=high`
