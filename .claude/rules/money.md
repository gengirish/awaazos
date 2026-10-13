---
description: Paise-integer money discipline — applies to all monetary code
paths: ["lib/currency.ts","lib/upi.ts","app/api/**/*.ts","components/**/*.tsx","lib/cartStore.ts","workers/**/*.ts"]
---

<!-- Generated from .cursor/rules/money.mdc by scripts/sync-agent-rules.mjs. Edit the source, then re-run. -->

# Money Discipline (Paise Integer Only)

## Banned in monetary code

- `Decimal`, `BigDecimal`, `prisma.Decimal`
- `Number.toFixed()`, `Number.toPrecision()` — `lib/upi.ts` is the only file
  allowed `toFixed` (non-money number formatting, e.g. admin metrics, uses
  `Intl.NumberFormat`)
- `parseFloat()`, `Math.round()` on prices
- Any arithmetic that goes through `number` for amounts > 1 paise

## Required helpers (`lib/currency.ts`)

```ts
export function paiseToRupees(paise: number): number      // throws on non-integer paise
export function rupeesToPaise(rupees: number): number     // throws on > 2 decimal places
export function formatINR(paise: number): string          // Intl.NumberFormat en-IN INR, always 2 decimals
export function formatINRCompact(paise: number): string   // menu boards only: ₹50 / ₹12.50 — never on bills
export function sumPaise(items: number[]): number         // integer sum
```

## Tax computation

```ts
// Tax is charged on the discounted value (an offer discount, lib/offers.ts, comes off first).
// Use bps (basis points) to keep tax percent as integer too.
const taxPaise = Math.floor(((subtotalPaise - discountPaise) * taxPercentBps) / 10_000);
const totalPaise = subtotalPaise - discountPaise + taxPaise;
```

## UPI deep link is the only place rupees touch the wire

```ts
// upi://pay?pa=...&am=20.00 — rupees, not paise (per UPI spec)
buildUpiDeepLink({ upiId, name, amountRupees: paiseToRupees(totalPaise), billRef });
// inside lib/upi.ts:
const am = amountRupees.toFixed(2);  // ONLY allowed toFixed in codebase
```

## Tests

Vitest unit tests (`lib/currency.test.ts`, `lib/upi.test.ts`) required for:
- `rupeesToPaise(20.555)` → throws (must be ≤2 decimals)
- `formatINR(200_000)` → `"₹2,000.00"` (en-IN format with grouping; `formatINR(2000)` is `"₹20.00"`)
- `formatINR(123456789)` → `"₹12,34,567.89"` (lakh formatting)
- `sumPaise([100, 200, 300])` → `600`
