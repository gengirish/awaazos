# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

AwaazOS is multi-tenant pre-ordering and billing for Instagram and WhatsApp home sellers: cloud
kitchens first (ICP in `docs/ICP.md`), other home businesses too (the first, from 2026-10-31, sells
holistic wellness products): storefront link in bio → Drops with a cut-off → UPI → orders board
and prep sheet.
It began as a voice-first counter POS (vendor speaks "do samosa aur ek chai" → Claude parses it
against the menu → UPI QR → WhatsApp receipt); that path still ships.

## Commands

```bash
npm run dev            # Next.js on :3000
npm run worker         # BullMQ workers (separate terminal; needs REDIS_URL)
npm run typecheck      # tsc --noEmit
npm run lint           # eslint . (ESLint 9 flat config, eslint.config.mjs)
npm test               # vitest run
npm run build          # next build
npm run e2e            # playwright (auto-starts dev server unless BASE_URL is set)
npm run perf:budget    # after a build: first-load JS per route vs perf-budget.json (CI gate)

npx prisma migrate dev --name <change>   # schema change → new prisma/migrations/<ts>_<change>/migration.sql (local DB)
npx prisma migrate deploy                # apply pending migrations to Neon (DIRECT_URL), BEFORE merging
npx prisma db push     # throwaway/e2e databases only (no seed script in this repo)
npm run db:studio

# Single test / single case
npx vitest run lib/__tests__/currency.test.ts
npx vitest run -t "formatINR"
npx playwright test e2e/public.spec.ts --project=chromium
```

Vitest only picks up `**/*.test.ts` (node environment, `@/` alias → repo root).

### E2E writes real rows — never point it at production

The suite registers vendors, creates menu items and rings up sales. `.env` is what
both Prisma and Next read, so running `npm run e2e` with production `DATABASE_URL`
in it seeds junk into the live database. Use a throwaway Postgres, same image CI uses:

```bash
docker run -d --name awaazos-e2e -p 5433:5432 -e POSTGRES_USER=ci -e POSTGRES_PASSWORD=ci -e POSTGRES_DB=awaazos postgres:15-alpine

export DATABASE_URL="postgresql://ci:ci@localhost:5433/awaazos?schema=public"
export DIRECT_URL="$DATABASE_URL"
npx prisma db push --skip-generate
npx playwright test --project=chromium

docker rm -f awaazos-e2e     # when done
```

Exported vars win: Next does not overwrite an env var that is already set.
`e2e/global-setup.ts` enforces this: a run stops before any spec if `DATABASE_URL` (exported, or in a
`.env` file when not exported) isn't local, if `BASE_URL` is production, or if `BASE_URL` is any other
deployment without `E2E_ALLOW_REMOTE=1`, because the vendor-creating specs write to that deployment's
database. `e2e/mobile-sweep.spec.ts` runs on the `mobile` project only (44 px is a coarse-pointer rule).

### Golden tests (LLM/ASR regression harness)

Live runs cost real money. The `live.test.ts` files match the Vitest glob, so `npm test` collects
them, but each live suite skips itself unless its `*_LIVE=1` flag is set. Offline validators run
in CI as part of `npm test`.

```bash
npm run test:golden:validate        # offline: fixture shape + menu refs
npm run test:golden:stt:validate    # offline

GOLDEN_PARSE_ORDER_LIVE=1 npm run test:golden      # real Claude run
GOLDEN_STT_LIVE=1 npm run test:golden:stt          # real ASR run (needs audio/ clips)
```

Windows PowerShell: `$env:GOLDEN_PARSE_ORDER_LIVE="1"; npm run test:golden`.
Failures dump diffs to `tests/golden/*/.last-run/<provider>/<id>.diff.json`.
See `tests/golden/parse-order/README.md` for the rule on qualifying a new provider
(pass rate within ~5% of Claude Haiku before it becomes a fallback).

### Provider smoke tests

`npm run smoke:sarvam | smoke:openai | smoke:groq | smoke:whisper` — one-shot
round-trips against a live STT provider, for checking credentials/connectivity.

## Deploy topology (three hosts, not one)

| Runs where | What |
| --- | --- |
| **Vercel** | Next.js App Router, all `/api/*` (Node runtime), edge middleware |
| **Fly.io (BOM)** | BullMQ workers — `workers/` — plus `services/whisper-stt` (optional Python ASR) |
| **Neon** | Postgres. `DATABASE_URL` = pooled, `DIRECT_URL` = direct (`prisma migrate deploy`) |

Vercel deploys through the Git integration: `vercel.json`'s `ignoreCommand` skips every non-production
build, so preview deployments are off and a push to `main` is a production deploy. The Fly worker app
named in `fly.toml` (`awaazos-workers`) does not currently exist (TODO.md 1.1), so nothing drains the
BullMQ queues in production.

**Two Redis surfaces, not interchangeable — the single easiest thing to get wrong:**

- `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` → `lib/kv.ts` (@upstash/redis over HTTP).
  Used on Vercel for rate limiting, idempotency, circuit breakers, AI usage caps, `/api/ready`.
  Serverless can't hold TCP, so anything running in an API route uses this.
- `REDIS_URL` (TCP `rediss://`) → `lib/queues.ts` (ioredis + BullMQ), the only TCP Redis client.
  Workers on Fly consume; API routes on Vercel enqueue (`voice-parse-log` and
  the dormant Gupshup receipt path). Without it on Vercel those enqueues fail; voice telemetry is
  dropped silently.
  On Vercel it must be a **public** endpoint — Fly `*.internal` hostnames are unreachable from Vercel.

`.vercelignore` excludes `workers/` from the Vercel build.

### Schema changes ship as migrations

Every `schema.prisma` change comes with its SQL in `prisma/migrations/` (Prisma Migrate). `0_init`
is a baseline of the schema as of 2026-10-21 and was never run on Neon — it is marked applied there
(`prisma migrate resolve --applied 0_init`). Merging is a production deploy and nothing runs
migrations on deploy, so `prisma migrate deploy` against Neon must finish **before** the PR merges;
otherwise every query that selects a missing column or table 500s. Don't edit a migration that has
been applied; add a new one. Check a branch: `prisma migrate diff --from-migrations prisma/migrations
--to-schema-datamodel prisma/schema.prisma --shadow-database-url <throwaway> --exit-code` (0 = in sync).

## Architecture

### Area rules load on demand

Each product area's full rules live in a path-scoped rule file, which Claude Code loads when a matching
file is read. Before changing an area, read its file if it isn't already in context.

| Rule file (`.cursor/rules/`, synced to `.claude/rules/`) | Covers |
| --- | --- |
| `voice-pipeline.mdc` | STT cascade per language, `parse-order` two-tier Claude, voice drop and menu builders |
| `storefront.mdc` | The public surface (`/s`, `/r`, `/d`, `/c`, `/survey`, `/api/s/**`, webhooks), store look, item sheet and photos, contact links, store app, community pages, landing page |
| `billing.mdc` | Trial / lock / subscriptions, `subscribeDecision`, plan tiers, list and custom prices, free access, seller alerts |
| `pos-transactions.mdc` | `POST /api/transactions`, receipts, undo, offline outbox |
| `drops-orders.mdc` | Drops, storefront payments (UPI claim, Razorpay, screenshots), the orders board, push and spoken alerts, menu orders, slots, delivery, order again, channels, bulk actions |
| `app-shell.mdc` | Store wording, `/home`, onboarding gate, setup checklist, tab bar, install, in-app Help |
| `catalogue.mdc` | Offers, inventory, sizes, cost price, stock purchases, AI images |
| `admin-growth.mdc` | Customer feedback, owner survey, admin decision pages, referrals, demo stores and outreach |

When you add a feature, put its detail in the matching rule file (or a new one with `globs`), and add to this
file only a rule that applies across areas.

### Cross-cutting rules

- **No timers.** Cut-offs, trial expiry, offer windows, stock holds and follow-ups are computed on every read;
  nothing is written when a date passes, so Neon can sleep. Board polling (6 min) stays above Neon's idle
  timeout. The only scheduled work is two daily Vercel Crons (trial reminders 09:00 IST, retention 09:05).
  Never add a recurring job or a shorter poll.
- **Store wording** follows `storeKind()` (`lib/store-vocabulary.ts`): "Menu" / "Products", "dish" /
  "product". New copy that names the catalogue goes through the vocabulary; a kitchen reads exactly as
  before. **"Drop" is the code's word only**: sellers and buyers read "Pre-order". Wording only: routes,
  models and API fields keep their names.
- **Voice:** never send audio to Anthropic, never use Claude for transcription; only transcript + menu enter
  the prompt. `stableMenuJson()` key and sort order is load-bearing for the prompt cache. Model output is
  re-anchored to real menu rows, never trusted. Telemetry is fire-and-forget.
- **Counter sales:** the server recomputes totals and writes bill sequence, transaction, items, daily summary
  and receipt in one `$transaction`; anything sent after (WhatsApp, logs) happens after commit and never
  blocks a sale. `OrderItem.name` / `priceInPaise` are snapshots. Receipts go out via `wa.me`, not Gupshup.
- **Drops:** the three invariants (no timers, no overselling via `FOR UPDATE`, sold counts derived) live in
  `lib/drops.ts` and nowhere else. **One orders board** (`/orders`): don't add a second orders page.
  A buyer's "I've paid" never marks an order paid. Online payment uses the **vendor's own** Razorpay
  account, never the platform one (that would make us a payment aggregator).
- **Billing:** `billingAccess(vendor)` derives `paid` / `trial` / `locked` / `free` on every read.
  `requireActiveBilling(ctx)` only on actions that make a new sale, take a new order or spend on AI, never
  on reads, settings, billing, export or finishing an existing order. Code that loads a vendor without
  `requireVendorRole` must select `planExpiresAt` **and** `trialEndsAt`. `plan` / `planExpiresAt` are
  written only through `recordSubscriptionEvent`.
- **Product name:** shown names read `BRAND_NAME` / `BRAND_TAGLINE` / `BRAND_SIGNOFF` (`lib/brand.ts`), never a
  literal; `lib/__tests__/brand.test.ts` fails on the former name. Device- and system-held identifiers keep the old
  spelling (`awaazos-pos`, `awz_*`, `AWZ-`, manifest `id`): see `docs/REBRAND_AWAAZDO_PLAN.md`.
- **In-app Help:** when you rename a screen, Settings section or button the guide quotes, update
  `lib/help-guide.ts`.

### Money is integer paise, everywhere

`Int` in Prisma, `number` in TS. `parseFloat`, `toFixed`, `Decimal`, and `Math.round` on prices are
banned. Use `lib/currency.ts` (`rupeesToPaise`, `paiseToRupees`, `formatINR`, `sumPaise`).
Tax uses basis points: `Math.floor(subtotalPaise * taxBps / 10_000)`.

**The one exception in the entire codebase** is `lib/upi.ts`, where the UPI spec requires decimal
rupees in the `am=` deep-link parameter. A stray `toFixed` anywhere else is a bug:

```bash
rg -l "toFixed" --glob '!lib/upi.ts' --glob '!*.md' app/ components/ lib/ workers/ hooks/   # must be empty
```

### Tenant isolation

`Vendor.id` is the tenant id; a `User` reaches vendors through `StaffMember`. Every protected
handler starts with `requireVendorRole(minRole, vendorIdOrSlug?, req?)` (`lib/rbac.ts`), which
resolves the active vendor as `?vendor=` → `awz_vendor` cookie → oldest membership. When it returns
a non-null `setVendorCookie`, the route should set that cookie on the response.

Every Prisma `where` touching tenant data must include `vendorId` — **use a compound `where` on
mutations** (`where: { id, vendorId: vendor.id }`), never a post-fetch ownership check.
Cross-tenant misses return **404, not 403** — don't leak existence.


**Public storefront surface** (full rules in `storefront.mdc`): `/s/[slug]/**`, `/r/[token]`, `/d/[token]`,
`/c/[slug]`, `/survey`, `/api/s/**` and the Razorpay order webhooks are unauthenticated and skip
`requireVendorRole`. Every one: gated on `VendorSettings.publishStorefront` where a store is involved
(not opted in → 404, not 403); a hand-written Prisma `select` allowlist (`Vendor.phone` / `Vendor.email`
never appear); pages keyed on a random token (`orderToken`, `publicToken`, `riderToken`) looked up with the
slug's `vendorId`, never a transaction `id`; every write IP rate-limited; no buyer PII in logs, Sentry,
push payloads or error bodies; no `loading.tsx` under `app/s` or `app/r` (it turns a 404 into a 200).

Two role axes: platform `UserRole` (`USER < SALES < ADMIN < SUPER_ADMIN`) and per-tenant `StaffRole`
(`CASHIER < MANAGER < OWNER`). Plan gates are separate again: `requirePlan(vendor, Plan.STARTER)`
throws `PlanGateError` (402) carrying `{ required, current }` so the UI can render an upgrade CTA.
Limits live in `PLAN_LIMITS` in `lib/constants.ts`.

### Env validation

`lib/env.ts` splits **boot-required** (`AUTH_SECRET`, `DATABASE_URL` — throw at import time) from
**feature-gated** (every integration key — optional at boot, asserted lazily via `requireEnv(key)`
when the integration actually runs). This is what lets CI build and typecheck with dummy env.
Don't promote a feature key to required.

## API route conventions

Full template and status-code table in `.cursor/rules/api-routes.mdc`. Essentials:

- `export const dynamic = "force-dynamic"` and `export const runtime = "nodejs"` on every
  vendor-scoped route (Prisma is not edge-safe; never cache cross-tenant).
- Shapes: list `{ data: T[] }` · create `{ data: T }` 201 · delete `{ success: true }` ·
  Zod fail `{ error, issues }` 400 · `AuthError` → `err.status` · plan gate 402 · 500 is
  `{ error: "Internal server error" }` with the real error only in the server log.
- Webhooks skip `requireVendorRole` and verify HMAC **before** any DB access. Middleware never runs
  on them: the `middleware.ts` matcher excludes `api/webhooks` (and `api/health`, `api/ready`).
  Other `/api/*` routes do pass through middleware, but `authorized()` in `lib/auth.config.ts`
  always lets them through so handlers return JSON 401/403 instead of a sign-in redirect.

## PII boundary (hard rule)

`Transaction.customerPhone`, customer name, and UPI UTR stay in Postgres for resend/reconciliation.
They must never reach Anthropic, an STT provider, `VoiceParseLog`, Sentry, or any log line. CSV
exports and log lines carry last-4 only. Audio bytes are streamed and discarded, never stored.

**Retention** (`lib/retention.ts`, `lib/retention-server.ts`): `VoiceParseLog` rows go after 90 days and
receipts after 7 years, the numbers the Privacy page promises. The daily Vercel Cron
`GET /api/cron/retention` (`vercel.json`, 09:05 IST, five minutes after trial-reminders so Neon is already awake;
`Bearer $CRON_SECRET`) deletes them in the request, no queue or worker; `POST /api/admin/retention/run`
(platform ADMIN) runs the same code by hand. Keep it daily: it touches Neon.


## Project rules

`.cursor/rules/*.mdc` are the enforced conventions: `security-first`, `tenant-isolation`, `india-locale`
always apply; the rest are scoped by glob (`money`, `voice-ai`, `api-routes`, `auth-rbac` (includes the
auth edge split), `design-system`, `accessibility`, plus the area files above).
Skill `modern-web-guidance` (Chrome's web-platform guides): new UI components, forms, dialogs/sheets/carousels, perf or a11y work only.

`.cursor/` is the source of truth. `.claude/rules/*.md` and `.claude/skills/` are generated from it
by `npm run sync:agent-rules` (`.mdc` `globs` → `.md` `paths`); edit the `.cursor/` file and re-run,
never the `.claude/` copy. `node scripts/sync-agent-rules.mjs --check` exits 1 on drift.

Accessibility is POS-critical: 44×44 px minimum tap targets, voice states distinguishable beyond color,
`aria-live` on cart and voice status, and **every voice-only path needs a tap fallback** (`QuickAddGrid`).

## Before pushing

CI (`.github/workflows/ci.yml`) runs lint → typecheck → unit → build → bundle-size budget
(`npm run perf:budget`, see `docs/PERFORMANCE.md`), plus gitleaks (full history) and `npm audit --audit-level=high`. Two Playwright jobs, `E2E (chromium)` and
`E2E (mobile)`, run after that on a throwaway Postgres: they apply the migrations from empty and check them against the schema. `main` has no
branch protection, so a red run does not stop a merge, which is a production deploy: look before merging. A husky
pre-commit hook runs `lint-staged` (eslint `--max-warnings=0`) and gitleaks if installed locally.

Repo workflow for a meaningful change: `npm test && npm run typecheck && npm run lint && npm run build`
→ conventional commit → push → green CI, E2E included (locally, Playwright against a throwaway Postgres:
see "E2E writes real rows" above). Merging to `main` is the production deploy (see "Deploy topology"); never run the e2e
suite against the production deployment, because its vendor-creating specs write to the live
database.

## Stack is locked

Auth.js v5 (`next-auth` beta) with `@auth/prisma-adapter` + bcryptjs, Neon Postgres, Prisma 6,
Vercel Blob (menu item photos `app/api/menu/[id]/image`; store banner and logo `app/api/vendor/banner|logo`). Don't install `@clerk/nextjs`,
`@supabase/supabase-js` or `svix`.

## Further reading

- `ARCHITECTURE.md` — system diagrams, full data model, latency budget, ADRs, trade-offs
- `TODO.md` — open items, ordered by what breaks if ignored
- `docs/README.md` (index), `docs/OBSERVABILITY.md`, `docs/runbooks/` — production ops
- `docs/PERFORMANCE.md` — mobile numbers, what is in the shared bundle, the CI bundle budget
- `docs/archive/` — frozen April 2026 material (kickoff spec, course, demo-video script); not a
  description of the current product
