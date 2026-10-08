---
description: Auth.js v5 + RBAC patterns for protected routes and server actions
paths: ["app/api/**/*.ts","app/(vendor)/**/*.tsx","app/(onboarding)/**/*.tsx","lib/auth.ts","lib/auth.config.ts","lib/rbac.ts","middleware.ts"]
---

<!-- Generated from .cursor/rules/auth-rbac.mdc by scripts/sync-agent-rules.mjs. Edit the source, then re-run. -->

# Auth.js v5 + RBAC — AwaazOS

## The edge split (mandatory)

| File | Runtime | Imports |
|---|---|---|
| `lib/auth.config.ts` | edge-safe | `NextAuthConfig`, `pages`, providers `[]`, callbacks (`authorized`, `jwt`, `session`) |
| `lib/auth.ts` | Node | `NextAuth({ ...authConfig, adapter: PrismaAdapter(prisma), session: { strategy: 'jwt' }, providers: [Credentials(...)] })` |

`middleware.ts` MUST import `auth.config.ts` only. Importing `auth.ts` from
middleware will fail at build time (Prisma not edge-compatible).

## Type augmentation

`src/types/next-auth.d.ts` — never `next-auth.d.ts` at workspace root, that
shadows the package import.

## RBAC primitives in `lib/rbac.ts`

```ts
export class AuthError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// 402 with { required, current } — extends AuthError, so catch it first
export class PlanGateError extends AuthError {
  constructor(public readonly required: Plan, public readonly current: Plan);
}

// Platform-wide (USER, ADMIN, SUPER_ADMIN)
export async function requirePlatformRole(role: UserRole): Promise<{ user }>;

// Per-tenant (OWNER > MANAGER > CASHIER)
export async function requireVendorRole(
  minRole: StaffRole,
  vendorIdOrSlug?: string | null,
  req?: NextRequest,               // pass it so `?vendor=` is honoured
): Promise<{ user, vendor, staff, setVendorCookie: string | null }>;

// Plan gate (FREE < STARTER < PRO < ENTERPRISE, via PLAN_RANK) — throws PlanGateError
export function requirePlan(vendor: { plan: Plan }, minPlan: Plan): void;
```

## Use everywhere

```ts
// API route — Cashier or above
const { vendor } = await requireVendorRole("CASHIER");

// Settings change — Owner only
const { vendor } = await requireVendorRole("OWNER");

// Saving the vendor's own Razorpay keys for storefront payments — OWNER + PRO
// (PUT /api/vendor/payments; PRO = PLAN_LIMITS[plan].razorpayLinks)
const ctx = await requireVendorRole("OWNER", undefined, req);
requirePlan(ctx.vendor, "PRO");
```

## Sign-up = one transaction

`POST /api/auth/register` MUST create User + Vendor + VendorSettings +
StaffMember(OWNER) inside `prisma.$transaction`. No webhooks. No split requests.
Map Prisma `P2002` → HTTP 409.

## Sign-in pages

- Custom shadcn forms (NOT Auth.js default).
- Wrap any `useSearchParams()` reader in `<Suspense>` or `next build` fails
  with the CSR-bailout error.
- After successful registration, immediately call `signIn(...)` so the user
  lands on `/onboarding` without re-authenticating.

## Common pitfalls

| Symptom | Fix |
|---|---|
| `'next-auth' has no call signatures` | Move type aug to `src/types/next-auth.d.ts` |
| `useSearchParams() should be wrapped in Suspense` at build time | Wrap form in `<Suspense fallback={null}>` |
| `session.user.role` is undefined | Add `jwt`+`session` callbacks AND `JWT` augmentation |
| Edge runtime: PrismaAdapter not supported | Middleware imports `auth.ts` — change to `auth.config.ts` |
| Database session strategy doesn't work | Credentials requires JWT — set `session: { strategy: 'jwt' }` |
