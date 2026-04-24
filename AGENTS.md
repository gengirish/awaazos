# AwaazOS — Agent Orientation

> **Read this entire file before doing anything.** It is the single source of
> truth for how subagents should work in this repo.

## What you're building

**AwaazOS** is a multi-tenant, voice-first POS SaaS for Indian small vendors.
Tagline: **"Bol. Bill. Becho."** A vendor presses a mic button, says
*"do bhel aur ek nimbu pani"*, and AwaazOS bills it, generates a UPI QR, and
sends a WhatsApp receipt — in any of 5 Indian languages.

**Full spec:** [`awaazos-cursor-prompt.md`](./awaazos-cursor-prompt.md) at the
repo root. Treat that file as authoritative for stack, schema, and feature
prompts.

## Stack (locked)

| Layer | Choice |
|---|---|
| Framework | Next.js 14 App Router · TypeScript strict |
| Auth | **Auth.js v5** + `@auth/prisma-adapter` + bcryptjs (NOT Clerk) |
| DB | **Neon** serverless Postgres (NOT Supabase) |
| ORM | Prisma 6 |
| UI | Tailwind + shadcn/ui (slate base) |
| AI | Anthropic Claude — **Haiku 4.5 primary + Sonnet 4.5 fallback**, tool-use |
| STT | Web Speech (en/hi) + **Sarvam Saaras v2** (te/kn/ta, STARTER+ only) |
| Payments | Razorpay subscriptions + UPI QR |
| WhatsApp | Gupshup |
| Storage | **Vercel Blob** (NOT Supabase Storage) |
| Jobs | BullMQ + **Redis TCP** (`REDIS_URL`, Fly workers) |
| Serverless KV | **Upstash REST** (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, Vercel — `lib/kv.ts`) |

## Project rules — applied automatically by Cursor

These live in `.cursor/rules/` and Cursor injects them based on the files you
edit. Skim them once so you know what's enforced:

- `india-locale.mdc` — paise integer money, IST dates, +91 phone, GST/HSN
- `tenant-isolation.mdc` — every query scoped to `vendor.id`, compound `where`
- `money.mdc` — banned constructs, required helpers, tax math in bps
- `auth-rbac.mdc` — Auth.js v5 edge split, `requireVendorRole`, sign-up tx
- `api-routes.mdc` — route template, response shapes, status codes
- `voice-ai.mdc` — STT routing, tool-use, prompt caching, Vitest fixtures
- `accessibility.mdc` — WCAG 2.2 AA, 44×44 px touch targets, ARIA states
- `design-system.mdc` — saffron-orange, Baloo 2 + Nunito, mobile-first
- `security-first.mdc` — secrets, PII, webhook HMAC, what NEVER to log

## Project skills — invoke when relevant

- `.cursor/skills/awaazos-claude-pipeline/SKILL.md` — voice → cart pipeline
- `.cursor/skills/awaazos-testing/SKILL.md` — Vitest + Playwright conventions

## User-level skills available (already discoverable by Cursor)

- **`auth-js-integration`** — REQUIRED for Phase 1 (foundation). Do not
  hand-roll Auth.js setup; follow the skill.
- `accessibility-compliance` — invoke when building UI
- `deploy-vercel` — invoke for Phase 4 deployment
- `llm-seo` — invoke when building marketing pages
- `create-rule` — invoke if you need to add a new `.cursor/rules/*.mdc`

## Reference codebases (read-only — do NOT copy code blindly)

| Repo | What to look at |
|---|---|
| `C:\Users\gengi\Documents\ImpactForge\` | Sidebar/Topbar shell · BullMQ + workers split · paise/INR validators · Serwist/PWA · libphonenumber usage |
| `C:\Users\gengi\Documents\citeforge\` | Razorpay client + signed webhook · Anthropic SDK lazy singleton · org+membership pattern · TanStack Table admin patterns |
| `C:\Users\gengi\Documents\medforce\` | Auth.js v5 with `orgId` in session · Razorpay actions |
| `C:\Users\gengi\Documents\nanoclaw-product\lexclaw\` | Tenant isolation tests |

When pulling patterns, **always** adapt to AwaazOS conventions
(`vendorId` not `orgId`, paise integer not Decimal).

## Build phases & dependency graph

```
Phase 1 (foundation, sequential):
   PROMPT 1 (scaffold) → PROMPT 2 (Prisma + libs) → PROMPT 3 (Auth.js)

Phase 2 (independent, parallel — fan out 4 subagents):
   ├── A: PROMPT 4 — Menu CRUD
   ├── B: PROMPT 5 — AI Voice Pipeline (transcribe + parse-order + tool-use)
   ├── C: PROMPT 9 — Razorpay Subscriptions + Plan Gates
   └── D: PROMPT 10 — Marketing Landing Page

Phase 3 (composition, sequential):
   PROMPT 6 (POS) → PROMPT 7 (Transactions+Receipts) → PROMPT 8 (Analytics)

Phase 4: Deployment (Vercel + Fly.io workers + Neon prod branch)
```

## Quality gates (every subagent must pass before reporting done)

1. `npm run typecheck` — zero errors
2. `npm run lint` — zero errors
3. `npm run build` — succeeds (validates middleware + edge split)
4. New code has tests per `.cursor/skills/awaazos-testing/SKILL.md`
5. No `Decimal` / `parseFloat` / `toFixed` for money (except UPI deep link)
6. Every protected route uses `requireVendorRole(...)` and queries scoped to `vendor.id`
7. No customer PII in any log, prompt, or telemetry

## How to run things locally

```bash
npm install                    # one-time
docker run -d --name awaazos-redis -p 6379:6379 redis:7-alpine   # one-time
npx prisma migrate dev         # apply schema
npx prisma db seed             # (after PROMPT 4 lands seed script)
npm run dev                    # Next.js on :3000
npm run worker                 # BullMQ workers (separate terminal)
npm run test                   # Vitest watch
npm run e2e                    # Playwright
```

## What NOT to do

- Do **not** install `@clerk/nextjs`, `@supabase/supabase-js`, or `svix`.
  We dropped Clerk and Supabase deliberately.
- Do **not** use floating-point math for money. Ever.
- Do **not** send customer phone, name, or UTR to any LLM or third-party API
  outside Razorpay/Gupshup/UPI (where they're functionally required).
- Do **not** create new top-level files (`*.md`, `package.json`, `tsconfig.json`)
  outside this repo. Stay scoped to `C:\Users\gengi\Documents\awaazos\`.
- Do **not** commit `.env.local`, real API keys, or the Neon password.
- Do **not** run `git push` unless explicitly told.

## Branch strategy (when working in parallel)

If you are a Phase 2 subagent, work on a feature branch:
```
phase2/menu-crud
phase2/voice-pipeline
phase2/razorpay-billing
phase2/marketing-landing
```
Open a PR to `main` when done. Do not merge — the orchestrator does that.
