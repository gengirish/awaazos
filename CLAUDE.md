# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

AwaazOS is a multi-tenant, voice-first POS for Indian micro-merchants: vendor speaks an order
("do samosa aur ek chai") → Claude parses it against that vendor's menu → UPI QR → WhatsApp receipt.

## Commands

```bash
npm run dev            # Next.js on :3000
npm run worker         # BullMQ workers (separate terminal; needs REDIS_URL)
npm run typecheck      # tsc --noEmit
npm run lint           # next lint
npm test               # vitest run
npm run build          # next build
npm run e2e            # playwright (auto-starts dev server unless BASE_URL is set)

npx prisma db push     # apply schema to Neon (no migration files in this repo)
npm run db:studio

# Single test / single case
npx vitest run lib/__tests__/currency.test.ts
npx vitest run -t "formatINR"
npx playwright test e2e/public.spec.ts --project=chromium
```

Vitest only picks up `**/*.test.ts` (node environment, `@/` alias → repo root).

### Golden tests (LLM/ASR regression harness)

Live runs cost real money and are **excluded** from `npm test`. Offline validators run in CI.

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

`npm run smoke:sarvam | smoke:openai | smoke:groq | smoke:nvidia | smoke:whisper` — one-shot
round-trips against a live STT provider, for checking credentials/connectivity.

## Deploy topology (three hosts, not one)

| Runs where | What |
| --- | --- |
| **Vercel** | Next.js App Router, all `/api/*` (Node runtime), edge middleware |
| **Fly.io (BOM)** | BullMQ workers — `workers/` — plus `services/whisper-stt` (optional Python ASR) |
| **Neon** | Postgres. `DATABASE_URL` = pooled, `DIRECT_URL` = direct (migrations) |

**Two Redis surfaces, not interchangeable — the single easiest thing to get wrong:**

- `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` → `lib/kv.ts` (@upstash/redis over HTTP).
  Used on Vercel for rate limiting, idempotency, circuit breakers, AI usage caps, `/api/ready`.
  Serverless can't hold TCP, so anything running in an API route uses this.
- `REDIS_URL` (TCP `rediss://`) → `lib/queues.ts` / `lib/redis.ts` (ioredis + BullMQ) on Fly.
  If set on Vercel it must be a **public** endpoint — Fly `*.internal` hostnames are unreachable
  from Vercel.

`.vercelignore` excludes `workers/` from the Vercel build.

## Architecture

### Voice pipeline: STT and NLU are deliberately separate (see ARCHITECTURE.md §3 ADR)

```
mic → STT (ASR only, no LLM) → transcript → /api/ai/parse-order (Claude) → cart
```

- **Never send audio to Anthropic. Never use Claude for transcription.** Only `transcript` + `menu`
  enter the LLM prompt.
- `POST /api/ai/transcribe` runs a per-language provider cascade, each hop guarded by its own
  circuit breaker (`lib/circuit-breaker.ts`, Upstash-backed) and minute quota (`lib/ai-usage-guard.ts`):
  - `te/kn/ta` → Sarvam → Groq → Whisper
  - `en/hi` → OpenAI → Groq → NVIDIA (legacy) → Whisper
  - Providers absent from env are skipped when building the cascade; Whisper only joins when
    `WHISPER_STT_URL` is set.
  - Cascade exhaustion returns **200** with `{ error: "all_providers_failed", fallback: "quickadd" }`
    — the client falls back to tap input, it is not an error state for the vendor.
  - `en/hi` normally never reach this route at all: the browser does Web Speech locally.
- `POST /api/ai/parse-order` runs two-tier Claude with forced `add_items` tool-use
  (`lib/anthropic.ts`). Haiku 4.5 primary → escalates to Sonnet 4.5 per `shouldEscalate()`
  (empty cart on a >3-word transcript, empty cart with no unmatched, or low confidence + unmatched)
  and on any Haiku throw. The menu JSON block carries `cache_control: ephemeral` and is emitted by
  `stableMenuJson()` — **key ordering and sort order are load-bearing for the prompt cache; don't
  reorder them casually.**
- Model output is not trusted directly: `alignParsedItemsToMenu()` re-anchors ids/prices to real
  menu rows and `rescueMatchFromTranscript()` (`lib/parse-order-align.ts`) does a last-ditch
  string match when the model returns nothing.
- Telemetry is fire-and-forget: enqueue `voice-parse-log` on BullMQ, never await, swallow enqueue
  failures. The cashier never waits on logging.

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

Two role axes: platform `UserRole` (`USER < ADMIN < SUPER_ADMIN`) and per-tenant `StaffRole`
(`CASHIER < MANAGER < OWNER`). Plan gates are separate again: `requirePlan(vendor, Plan.STARTER)`
throws `PlanGateError` (402) carrying `{ required, current }` so the UI can render an upgrade CTA.
Limits live in `PLAN_LIMITS` in `lib/constants.ts`.

### Transaction write path

`POST /api/transactions` recomputes subtotal/total server-side and rejects mismatches with 400, then
does everything in one `prisma.$transaction`: `billSequence.upsert` (atomic per-`(vendorId, date)`
increment producing `AWZ-YYYYMMDD-NNNN`) → `transaction.create` with nested `orderItems` →
`dailySummary.upsert` → `receipt.create`. WhatsApp enqueue happens **after** commit and its failures
are logged and swallowed — Redis being down must never block a sale.

`OrderItem.name` and `priceInPaise` are snapshots, not joins. Renaming or deleting a menu item must
not mutate historical bills.

### Auth edge split

`lib/auth.config.ts` is edge-safe (no Prisma) and is the **only** auth module `middleware.ts` may
import; `lib/auth.ts` adds the Prisma adapter and Credentials provider on Node. Session strategy is
JWT (Credentials requires it). Type augmentation lives in `src/types/next-auth.d.ts` — putting it at
the workspace root shadows the package import. `POST /api/auth/register` creates
User + Vendor + VendorSettings + StaffMember(OWNER) in a single `prisma.$transaction`, mapping
Prisma `P2002` → 409.

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
- Webhooks skip `requireVendorRole`, verify HMAC **before** any DB access, and must be allowlisted
  in `auth.config.ts` so middleware doesn't redirect them.

## PII boundary (hard rule)

`Transaction.customerPhone`, customer name, and UPI UTR stay in Postgres for resend/reconciliation.
They must never reach Anthropic, an STT provider, `VoiceParseLog`, Sentry, or any log line. CSV
exports and log lines carry last-4 only. Audio bytes are streamed and discarded, never stored.

## Project rules

`.cursor/rules/*.mdc` are the enforced conventions and are worth reading before touching the
matching area — `money.mdc`, `tenant-isolation.mdc`, `security-first.mdc` (always apply);
`india-locale.mdc`, `voice-ai.mdc`, `api-routes.mdc`, `auth-rbac.mdc`, `design-system.mdc`,
`accessibility.mdc` (scoped by glob).

India-locale specifics that bite: store UTC / display IST (`Asia/Kolkata`), `DD/MM/YYYY` in UI,
phones validated as +91 10-digit and stored E.164 via `libphonenumber-js`.

Accessibility is POS-critical, not decorative: 44×44 px minimum tap targets (mic button 80×80),
voice states distinguishable beyond color, `aria-live` on cart and voice status, and **every
voice-only path needs a tap fallback** (`QuickAddGrid`).

## Before pushing

CI (`.github/workflows/ci.yml`) runs lint → typecheck → unit → build, then Playwright against a
Postgres service, plus gitleaks (full history) and `npm audit --audit-level=high`. A husky
pre-commit hook runs `lint-staged` (eslint `--max-warnings=0`) and gitleaks if installed locally.

Repo workflow for a meaningful change: `npm test && npm run typecheck && npm run lint && npm run build`
→ conventional commit → push → `vercel --prod --yes` → `BASE_URL=https://awaazos.vercel.app npm run e2e`.

## Further reading

- `ARCHITECTURE.md` — system diagrams, full data model, latency budget, ADRs, trade-offs
- `AGENTS.md` — agent orientation; stack is locked (no Clerk, no Supabase, no svix)
- `awaazos-cursor-prompt.md` — authoritative product spec
- `HARDENING.md`, `docs/OBSERVABILITY.md`, `docs/runbooks/` — production ops
