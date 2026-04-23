---
name: awaazos-testing
description: Testing conventions for AwaazOS — Vitest unit/integration tests + Playwright E2E. Use when adding tests for any new route, lib helper, component, or worker.
---

# AwaazOS Testing

## Stack

- **Vitest** — unit + integration (Prisma against test schema)
- **@testing-library/react + jsdom** — component tests
- **Playwright** — E2E for the POS happy path
- **axe-core** (`@axe-core/playwright`) — accessibility audits

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

Located at `e2e/pos-happy-path.spec.ts`. Must cover:
1. Sign in as test vendor owner
2. Navigate to /pos
3. Click a menu item in QuickAddGrid (skip mic in CI)
4. Click "Collect Payment"
5. Verify UPI QR renders (image with valid `data-testid="upi-qr"`)
6. Enter UTR ref, click "Mark as Paid"
7. Verify success toast + cart cleared
8. Verify a Transaction row exists in DB with correct totalPaise

## Accessibility audit

```ts
import { injectAxe, checkA11y } from "@axe-core/playwright";

test("POS screen passes axe", async ({ page }) => {
  await page.goto("/pos");
  await injectAxe(page);
  await checkA11y(page, undefined, { detailedReport: true });
});
```

## Test database

- Use a separate Neon branch for tests, OR a local Postgres via Docker
- `vitest.setup.ts` runs `prisma migrate deploy` against `TEST_DATABASE_URL`
- Each test file gets a fresh transaction (rolled back in `afterEach`)

## CI

GitHub Actions: typecheck → lint → vitest → build → playwright (on a Vercel preview URL). Fail fast.
