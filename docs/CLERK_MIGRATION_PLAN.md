# Migration plan: Auth.js v5 → Clerk (vendor/staff auth only)

Drafted 2026-10-06 against `main` at `d754bfa`. Nothing in this plan has been applied yet.
It reverses a recorded decision (`ARCHITECTURE.md` ADR "Auth.js v5 over Clerk", `AGENTS.md`
"do not install `@clerk/nextjs`"), so Phase 0 updates those first, in the same PR as the code.

## Scope

| In scope | Out of scope |
|---|---|
| Staff/vendor sign-in, sign-up, sign-out, password reset | Buyer auth (`Customer` + magic link, `awz_cust` cookie, `lib/customer-auth.ts`) — unchanged |
| `middleware.ts`, `lib/auth*.ts`, `lib/rbac.ts` session lookup | Tenant model (`Vendor`, `StaffMember`, `StaffRole`) — unchanged |
| Moving vendor creation out of `POST /api/auth/register` | Clerk Organizations (see D3) |
| Importing existing users with their bcrypt hashes | Webhooks, Fly workers (they never read sessions) |

## Core design decision

**Clerk owns identity; Postgres keeps owning authorization.**

- Clerk answers "who is this person" (email, password, sessions, reset, MFA later).
- Prisma `User` stays the row every `StaffMember` points at, and `User.role` (platform role) stays
  in Postgres. Nothing about tenancy or `StaffRole` moves into Clerk metadata.
- The link is one new column: `User.clerkUserId String? @unique`.
- `requireVendorRole()` / `requirePlatformRole()` keep their signatures and return shapes, so the
  44 files that call them don't change. Only the first ~10 lines of each (session → `User`) change.

This keeps the blast radius to auth plumbing. The tenant-isolation rules, 404-not-403 behaviour,
`awz_vendor` cookie resolution and plan gates stay exactly as they are.

## What exists today (inventory)

| File | Role today | Fate |
|---|---|---|
| `lib/auth.config.ts` | Edge-safe Auth.js config, `isPublicPath()`, JWT/session callbacks | Delete; `isPublicPath` logic moves into middleware |
| `lib/auth.ts` | NextAuth + PrismaAdapter + Credentials; `requireUser()` | Replace with Clerk-backed `requireUser()` / `currentDbUser()` |
| `middleware.ts` | `NextAuth(authConfig).auth` | `clerkMiddleware()` |
| `lib/rbac.ts` | `auth()` → `User`, `assertSessionNotStale()`, role/plan guards | Swap session lookup; delete `assertSessionNotStale` |
| `app/api/auth/[...nextauth]/route.ts` | Auth.js handlers | Delete |
| `app/api/auth/register/route.ts` | Creates User + Vendor + VendorSettings + StaffMember(OWNER) | Becomes `POST /api/onboarding/vendor` (see Phase 3) |
| `app/api/auth/forgot-password`, `reset-password` + pages | Own reset flow, `PasswordResetToken` | Delete (Clerk handles reset) |
| `app/(auth)/sign-in`, `sign-up` pages | Custom forms, `signIn("credentials")` | Clerk `<SignIn />` / `<SignUp />` catch-all routes, kept on-brand via `appearance` |
| `components/providers.tsx` | `SessionProvider` | `ClerkProvider` (inside `<body>`) |
| `app/(marketing)/pricing/page.tsx` | `auth()` for "signed in?" | Clerk `auth()` |
| `app/api/me/route.ts` | `requireUser()`; DELETE removes the account | Also delete the Clerk user (Backend API) |
| `app/admin/metrics/page.tsx` | `session.user` | `requirePlatformRole()` |
| `src/types/next-auth.d.ts` | Session type augmentation | Delete |
| `lib/password.ts`, `lib/password-strength.ts`, `lib/zod-auth.ts` (sign-in/up schemas) | bcrypt + policy | Delete after import script has run |
| Prisma `Account`, `Session`, `VerificationToken`, `PasswordResetToken`; `User.passwordHash`, `passwordChangedAt`, `emailVerified` | Auth.js adapter tables | Drop in Phase 6, after a release of soak |

Findings worth knowing before starting:

- **There is no vendor sign-out button anywhere** today (only the buyer one). The migration adds
  Clerk `<UserButton />` to the vendor shell, which fixes that gap.
- **Staff are only ever created at registration.** There is no invite-a-cashier flow yet, so there
  is no invite path to migrate. When one is built later, Clerk invitations are the natural fit.
- `next` is `^14.2.21`. Confirm `@clerk/nextjs`'s peer range accepts the installed version before
  starting; bumping to the latest 14.2.x is worth doing anyway (14.2.25 fixed the
  `x-middleware-subrequest` middleware-bypass CVE, which matters more once middleware is the
  auth gate).

## Phases

Each phase is one PR. Phases 1–5 ship together as a single cutover deploy (see "Cutover").

### Phase 0 — Decision and docs (no code)

1. Resolve open decisions D1–D5 below.
2. Rewrite the `ARCHITECTURE.md` ADR (line ~529) with the new reasoning, and record why the two
   original objections (pricing at scale, +91 SMS OTP cost) are now acceptable.
3. `AGENTS.md`: change the Auth row (line 22) and remove `@clerk/nextjs` from the banned list
   (lines 118–119). Keep the `svix` ban: Clerk webhooks can be verified with
   `verifyWebhook` from `@clerk/nextjs/webhooks`, and this plan doesn't need webhooks anyway.
4. `CLAUDE.md` "Auth edge split" section and `.cursor/rules/auth-rbac.mdc`: rewrite for Clerk.
5. Create a Clerk **development** instance for local/CI and a **production** instance for Vercel.
   In the dashboard: email + password sign-in, email verification on, "sign out of other sessions
   on password change" on, application domain set.

### Phase 1 — Install and wire Clerk alongside (dark)

- `npm i @clerk/nextjs` (plus `@clerk/testing` as a dev dependency for Phase 5).
- `lib/env.ts`: add `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`. These are core
  auth, not a feature integration, so they replace `AUTH_SECRET` as **boot-required**. CI builds
  with the dev instance's keys (the publishable key isn't secret; the secret key is a GH Actions
  secret). This is the one deliberate exception to "don't promote a feature key to required".
- Prisma: `User.clerkUserId String? @unique`. Additive, safe to `db push` ahead of the cutover.

### Phase 2 — User import script

`scripts/import-users-to-clerk.ts`, run once against production right before cutover:

- For each `User` with `clerkUserId = null`: `clerkClient.users.createUser({ emailAddress: [email],
  passwordDigest: passwordHash, passwordHasher: "bcrypt", externalId: user.id, firstName/lastName
  from name, skipPasswordChecks: true })`, then write `clerkUserId` back.
- Idempotent: if Clerk says the email already exists, look it up by email and link it.
- Users with no `passwordHash` get created passwordless and will use "forgot password" once.
- Log counts only, never emails (PII rule). `--dry-run` flag prints counts.
- Clerk rate-limits its Backend API; throttle (e.g. sequential with a small delay). At current
  user counts this is minutes, not hours.

Existing passwords keep working because Clerk verifies the imported bcrypt digest. Every user is
signed out once at cutover (Auth.js JWTs stop being read); that is the only user-visible cost.

### Phase 3 — Server: session → `User`, and onboarding replaces register

**`lib/auth.ts`** becomes a small Clerk-backed module:

```ts
// currentDbUser(): Clerk session → Prisma User, or null.
const { userId } = await auth();              // @clerk/nextjs/server, always awaited
if (!userId) return null;
let user = await prisma.user.findUnique({ where: { clerkUserId: userId } });
if (!user) user = await linkOrCreateUser(userId);   // first request after sign-up only
```

`linkOrCreateUser` fetches the Clerk user once, takes the **primary, verified** email, and either
links an existing `User` with that email (covers anyone the import missed) or creates a bare
`User`. Never link on an unverified email — that would be an account takeover. This is lazy,
on the read path: no Clerk webhook, no timer, nothing that keeps Neon awake.

**`lib/rbac.ts`**: `requireVendorRole` / `requirePlatformRole` call `currentDbUser()` instead of
`auth()` + `findUnique`. Delete `assertSessionNotStale` — Clerk revokes sessions server-side on
password change, which is strictly better than the `passwordChangedAt` comparison. Error types,
statuses and the `setVendorCookie` contract are unchanged.

**Register → onboarding.** Clerk's `<SignUp />` only creates the identity. The vendor half of
today's register route moves to `POST /api/onboarding/vendor`:

- Requires a signed-in Clerk session and a `User` with **zero** `StaffMember` rows (else 409).
- Body: `name`, `stallName`, `stallType`, optional `phone` (same Zod schema and E.164 handling as
  today, minus email/password).
- Same single `prisma.$transaction`: Vendor + VendorSettings + StaffMember(OWNER), same slug retry
  loop, same `P2002 → 409`, same `awz_vendor` cookie, same IP rate limit.
- `requireVendorRole` already throws 403 "No vendor membership." for a signed-in user with no
  vendor. Vendor pages should catch that and redirect to `/onboarding` instead of erroring.
- `/onboarding` gets a new step 0 ("Name your stall") shown only when the user has no vendor;
  the existing 4 steps stay as they are.
- Sign-up `forceRedirectUrl="/onboarding"`.

**`app/api/me` DELETE**: delete the Prisma user (as today), then
`clerkClient.users.deleteUser(clerkUserId)`. If the Clerk call fails, log and still return success
— the orphaned Clerk identity has no data and can't reach any vendor.

### Phase 4 — Middleware and UI

`middleware.ts`:

```ts
const isPublic = createRouteMatcher([
  "/", "/sign-in(.*)", "/sign-up(.*)", "/pricing(.*)", "/features(.*)",
  "/s/(.*)", "/api/(.*)",   // API handlers return JSON 401/403/402 themselves (same as today)
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublic(req)) await auth.protect();   // page navigations → redirect to /sign-in
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/webhooks|api/health|api/ready).*)",
    "/__clerk/:path*",
  ],
};
```

Keep the existing exclusions: webhooks must accept anonymous signed POSTs, and `/api/health` /
`/api/ready` must stay outside middleware. Clerk verifies the session JWT locally in middleware
(no network call, no DB), so nothing new touches Neon per request.

UI:

- `components/providers.tsx`: `ClerkProvider` inside `<body>`, with `appearance` mapped to the
  design-system tokens. Check the 44 px tap-target and label rules (`accessibility.mdc`) against
  Clerk's components and fix with `appearance.elements` where needed.
- `app/(auth)/sign-in/[[...sign-in]]/page.tsx` and `sign-up/[[...sign-up]]/page.tsx` render
  `<SignIn />` / `<SignUp />` inside the current card layout. Delete `forgot-password`,
  `reset-password` pages and API routes.
- Vendor shell header: `<UserButton />` (adds the missing sign-out). Marketing nav: show
  `SignInButton` / `SignUpButton` when signed out, a "Go to dashboard" link plus `<UserButton />`
  when signed in.
- `localization`: Clerk ships `@clerk/localizations` (has `hiIN` and others) if Hindi auth
  screens are wanted later. Not in this cut.

### Phase 5 — Tests and CI

- Unit: `lib/rbac` tests mock `currentDbUser()` instead of `auth()`. Add tests for
  `linkOrCreateUser` (verified email links, unverified email does **not**, existing
  `clerkUserId` short-circuits) and for `/api/onboarding/vendor` (409 when a vendor exists).
- E2E: `e2e/helpers/vendor.ts` and `register-owner.ts` currently POST `/api/auth/register` and
  fill the sign-in form. Replace with: create a Clerk user via Backend API (dev instance) →
  `@clerk/testing/playwright` `setupClerkTestingToken` + `clerk.signIn` → POST
  `/api/onboarding/vendor`. Use `+clerk_test` emails so no real mail goes out.
- Rewrite `e2e/auth-flows.spec.ts`: duplicate-email and weak-password cases now belong to Clerk.
  Keep "wrong password stays on /sign-in", "sign-in lands on /onboarding or dashboard", and add
  "signed-in user with no vendor is sent to /onboarding". Keep the accessibility spec on
  `/sign-in`.
- E2E users accumulate in the Clerk dev instance; a teardown deletes users created by the run.
- CI gains a dependency on Clerk's dev instance being reachable. Accept it, or keep a small
  smoke-only E2E job that doesn't sign in.

### Phase 6 — Cleanup (one release after cutover)

- `npm rm next-auth @auth/prisma-adapter bcryptjs`.
- Prisma: drop `Account`, `Session`, `VerificationToken`, `PasswordResetToken`, and
  `User.passwordHash`, `passwordChangedAt`, `emailVerified`; make `clerkUserId` required.
  Take a Neon branch snapshot first; this repo uses `db push`, so the drop is irreversible
  without it.
- Remove `AUTH_SECRET`, `AUTH_URL`, `AUTH_TRUST_HOST` from `lib/env.ts`, Vercel, `.env.example`,
  the DB-test command lines in `lib/__tests__/*.db.test.ts`, and the TODO.md items about
  `AUTH_URL` (lines ~227–228).

## Cutover (production)

1. Neon: create a branch snapshot of production.
2. Vercel: add production Clerk keys (`vercel env add`), alongside the existing `AUTH_*` vars.
3. `prisma db push` the additive `clerkUserId` column.
4. Run `scripts/import-users-to-clerk.ts --dry-run`, then for real. Confirm every `User` has a
   `clerkUserId` (count query).
5. Deploy Phases 1–5. Smoke: sign in as an imported user with their old password, ring up a sale,
   open `/drops`, open a public storefront signed out, place a buyer order.
6. **Rollback:** redeploy the previous Vercel deployment. Auth.js tables and `passwordHash` are
   still intact until Phase 6, so old sessions/passwords work again. Users who signed up on Clerk
   during the window would have a `User` row with no password — they'd need "forgot password"
   on the old flow. Keep the window short.

## Risks

| Risk | Mitigation |
|---|---|
| Account takeover via email auto-linking | Link only on Clerk's primary **verified** email; unit-tested |
| Users locked out after cutover | bcrypt digest import; rollback path keeps old tables until Phase 6 |
| Vendor pages error for users with no vendor | Catch 403 "No vendor membership." → redirect `/onboarding` |
| Clerk outage = nobody can sign in | Accepted vendor dependency; existing sessions still verify locally until expiry |
| Personal data now held by a US processor | Update privacy policy; check DPDP Act obligations (D5) |
| Cost at scale (the original ADR objection) | Re-check current Clerk pricing against projected MAU before Phase 0 sign-off |
| Clerk components miss POS accessibility rules | Audit against `accessibility.mdc` in Phase 4; fix via `appearance.elements` |

## Open decisions (owner: Girish)

| # | Question | Blocks |
|---|---|---|
| D1 | Why move now? Record the reason in the ADR (e.g. MFA, social login, phone OTP, less auth code to own). | Phase 0 |
| D2 | Sign-in methods at launch: email + password only (matches today), or add Google and/or +91 phone OTP? Phone OTP has per-SMS cost in India. | Phase 0 dashboard setup, Phase 4 |
| D3 | Clerk Organizations: stay with `Vendor` + `StaffMember` (recommended; tenancy is wired through every query) or plan a later move? | Nothing now; affects any future staff-invite work |
| D4 | How many production `User` rows exist today? Decides whether the import is a one-off script run (recommended) or needs batching/backoff. | Phase 2 |
| D5 | Is a US-hosted identity provider acceptable for vendor email/name under DPDP, and does the privacy policy need updating before cutover? | Cutover |
