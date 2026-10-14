# AwaazOS — Bol. Bill. Becho.

> **Pre-orders and billing for India's Instagram cloud kitchens.**
> Post a batch with a cut-off → buyers order from your link in bio → paid by UPI → cook list and delivery list on the day. Voice POS for counter sales. ₹0 to start.

[![Live](https://img.shields.io/badge/live-awaazos.vercel.app-brightgreen)](https://awaazos.vercel.app)
[![Stack](https://img.shields.io/badge/stack-Next.js%2014%20%C2%B7%20Auth.js%20%C2%B7%20Neon%20%C2%B7%20Claude%204.5-blueviolet)](#-tech-stack)
[![License](https://img.shields.io/badge/license-proprietary-lightgrey)](#-license)

> **Status:** Production-deployed, with design-partner vendors in Hyderabad. Live counts are on the admin-only `/admin/metrics` page.

---

## 🎬 60-Second Demo

> Voice command in Hindi → cart fills in real time → UPI QR → WhatsApp receipt. Sixty seconds, end-to-end, on a real phone, in a real chai stall.
>
> _The recorded video is not published yet. The original April 2026 script is archived (and partly stale) at [`docs/archive/DEMO_VIDEO.md`](./docs/archive/DEMO_VIDEO.md)._
>
> _**Live** walkthroughs (Zoom / investor rooms): [`docs/DEMO_GUIDE.md`](./docs/DEMO_GUIDE.md)._

---

## 🌐 Live demo

| Surface | URL |
| --- | --- |
| **Production app** | https://awaazos.vercel.app |
| **Pricing** | https://awaazos.vercel.app/pricing |
| **Sign up** | https://awaazos.vercel.app/sign-up |
| **GitHub** | https://github.com/gengirish/awaazos |
| **60s video demo** | _not published yet_ |
| **Live demo script** | [docs/DEMO_GUIDE.md](./docs/DEMO_GUIDE.md) _(Zoom / investors)_ |

> 60-second test: sign up → onboard a stall → add 3 menu items → open `/pos` on your phone → tap the orange mic → say _"do samosa aur ek chai"_ → see the cart fill → scan the UPI QR → bill `AWZ-YYYYMMDD-0001` is generated atomically → check `/analytics`.

---

## 🎯 Who it's for

**Instagram-based cloud kitchens**: home bakers, meal-box kitchens, snack and sweet makers who find
buyers on Instagram and sell direct, not through Swiggy or Zomato. Today their orders live in DMs,
payments are UPI screenshots, and the cook list is a notebook. Full profile, fit and gaps:
[docs/ICP.md](./docs/ICP.md).

What they use: the storefront `/s/[slug]` as their link in bio, **Drops** (a batch with a cut-off
and capped stock), UPI / pay-on-delivery / their own Razorpay, the orders board and prep sheet,
Web Push alerts, and a ready-made Instagram story image for each drop.

The sections below describe the original counter-POS wedge (street stalls and kiranas). That
product still ships and still works; it is no longer who we build for first.

## 🌶️ The problem (original counter-POS wedge)

India has **63 million MSMEs** and **~25 million micro-merchants** — chai walas, dosa carts, kirana shops, samosa stalls, paan shops. They:

- Take orders verbally in Hindi / Telugu / Kannada / Tamil / Marathi / Bengali (rarely in English)
- Hand-write bills on paper or skip billing entirely (lose 15-20% of revenue to inventory leakage and disputes)
- Accept UPI but can't tie payments to orders
- Have no idea which item sold most, what their busiest hour is, or how much they actually made today
- Can't afford ₹2,000-5,000/mo POS systems built for English-speaking, literate restaurant managers

**The gap**: existing POS software (Petpooja, Zomato Hub, Square clones) assumes a manager-class user who can type, navigate menus, and trust an English UI. That cuts out 90% of India's actual point-of-sale.

## 💡 The solution

A POS where **the only interface is your voice and your eyes**.

1. Vendor speaks the order in Hindi or English → the browser's Web Speech API transcribes it (a server-side STT cascade exists as an opt-in fallback; see Tech stack below)
2. Claude Haiku 4.5 parses the transcript against this vendor's exact menu (with prompt caching) and emits structured items via tool-use
3. Cart fills, total computes in paise (no float math, ever)
4. Vendor taps **Collect Payment** → big UPI QR code → customer scans with GPay / PhonePe / Paytm
5. Mark as paid → atomic bill number `AWZ-20260423-0001` → DB transaction commits → vendor taps **Send on WhatsApp** and the receipt opens pre-filled in their own WhatsApp (`wa.me` link)
6. Owner sees real-time dashboards (revenue trend, top sellers, hourly heatmap, voice adoption %)

All of this on a phone, in <8 seconds per transaction. **Hindi + English at MVP. More on roadmap once 50 vendors are active.**

---

## ✨ Features

### Built and shipped

- 🎙️ **Voice-first POS** — 80×80 mic button, 6 visual states (idle / listening / transcribing / parsing / success / error), distinguishable beyond color, full `aria-live` for screen readers
- 🌍 **STT routing** — Web Speech in the browser for English & Hindi. A server cascade (`/api/ai/transcribe`, STARTER+) is wired with per-provider circuit breakers: OpenAI → Groq → self-hosted Whisper for en/hi, Sarvam Saaras v3 → Groq → Whisper for Telugu / Kannada / Tamil. te/kn/ta are **dormant**: the code and golden fixtures are kept, but the language picker offers only English and Hindi
- 🧠 **Two-tier AI parsing** — Claude Haiku 4.5 primary with ephemeral prompt caching on the menu, escalates to Sonnet 4.5 on empty or low-confidence results (`shouldEscalate()`) or a Haiku error
- 💰 **Integer-paise math everywhere** — no `parseFloat`, no `toFixed` (single exception: UPI deep-link `am=` per spec)
- 🔢 **Atomic bill numbering** — `AWZ-YYYYMMDD-NNNN` via `BillSequence.upsert` inside `prisma.$transaction`, race-safe across concurrent sales
- 📲 **WhatsApp receipts** — the vendor sends the bill from their own WhatsApp via a pre-filled `wa.me` link (`GET /api/receipts/message`); no Business API, no template, free on every plan. Customer phone is PII-protected (never logged, only last-4 in CSV exports). An older Gupshup + BullMQ path is still in the code but unused by the UI
- 💳 **UPI deep links + QR** — vendor's own UPI ID, no MDR fees, scannable from any UPI app
- 📊 **Analytics dashboard** — Recharts revenue trend, hourly heatmap, top sellers, voice adoption %, payment method breakdown — every chart has a `<details>` data table for accessibility
- 🏢 **Multi-tenant** — `vendorId` scoping enforced on every query, two-layer RBAC (platform `UserRole` + per-tenant `StaffRole`)
- 💸 **Razorpay subscriptions** — ₹299/mo per vendor, FREE up to 50 transactions a month, plan gates with `PlanGateError(402)` returning structured upgrade prompts
- 🖼️ **Store banner & logo** — the owner uploads a cover photo and logo for `/s/[slug]` in Settings → Online store; photos are shrunk on the phone before upload
- 🛍️ **Public storefront + Drops** — opt-in `/s/[slug]` page where buyers order from the everyday menu or from a pre-order "drop" (cut-off, capped stock, orders board, prep sheet). Payment by UPI + UTR, pay on delivery, or the vendor's own Razorpay keys
- 📸 **Instagram story image** — one tap on a drop makes a 1080×1920 PNG (items, prices, cut-off, order link) inside Instagram's safe zones, and copies the storefront link for the Link sticker (`GET /api/drops/[id]/story-image`)
- 🔔 **Web Push alerts** — new storefront orders and submitted UPI references push to the vendor's opted-in devices (`lib/push.ts`, `public/sw.js`)
- 🇮🇳 **India-first defaults** — IST timezone, DD/MM/YYYY dates, `+91` 10-digit phone validation, `Intl.NumberFormat('en-IN', { currency: 'INR' })`, `libphonenumber-js`
- 🔐 **Auth.js v5 (NextAuth)** — Edge-split config, JWT sessions, Credentials provider with bcrypt, single `prisma.$transaction` for sign-up
- 🎨 **Mobile-first UI** — Tailwind + shadcn/ui, saffron AwaazOS palette (`--awaaz-orange` AA-contrast), Baloo 2 + Nunito Indic-friendly fonts

### Roadmap

Driven by [docs/ICP.md](./docs/ICP.md) "Gaps": checkout inside Instagram's in-app browser, DM
quick replies, delivery hand-off from the prep sheet, then pricing copy for kitchens.

_Also planned, not shipped:_ automated accessibility audits in CI (`@axe-core/playwright` is not installed today — a11y is hand-checked against the `aria-live`, contrast, and chart-data-table work listed above).

---

## 🏗️ Tech stack

| Layer | Choice | Why |
| --- | --- | --- |
| **Frontend** | Next.js 14 App Router + TypeScript strict | RSC for server-side data fetch, no waterfall to API |
| **UI** | Tailwind CSS + shadcn/ui (slate) | Fast iteration, accessible primitives, mobile-first |
| **Charts** | Recharts ^2.15 | SSR-friendly, accessible (data tables sibling) |
| **Auth** | Auth.js v5 (NextAuth) + `@auth/prisma-adapter` + bcryptjs | No vendor lock-in, edge-safe middleware, JWT sessions |
| **Database** | Neon Serverless PostgreSQL | Branchable, scales to zero, Indian-region availability |
| **ORM** | Prisma | Type-safe, `$transaction` for atomicity, `upsert` for idempotency |
| **AI / Voice** | Anthropic Claude Haiku 4.5 (primary) + Sonnet 4.5 (fallback), tool-use, prompt caching | Best Indic instruction-following at lowest cost |
| **STT** | Web Speech API (en/hi, in-browser) + server cascade: OpenAI `gpt-4o-mini-transcribe`, Groq `whisper-large-v3-turbo`, Sarvam Saaras v3 (dormant te/kn/ta), self-hosted Whisper on Fly | Web Speech is free and needs no server call from us; the cascade covers the opt-in server path, each hop behind its own circuit breaker |
| **Background jobs** | BullMQ + Redis (Fly.io workers) | Voice telemetry, retention runs, retries with backoff |
| **Serverless KV** | [@upstash/redis](https://github.com/upstash/redis-js) HTTP on Vercel | Rate limits, idempotency keys, AI usage caps; no TCP from serverless |
| **Payments** | Razorpay subscriptions (platform) · UPI deep link + QR (POS) · vendor's own Razorpay keys (storefront) | India-first; storefront money goes to the vendor, never through the platform |
| **Messaging** | `wa.me` links from the vendor's own WhatsApp · Web Push (`web-push`, VAPID) · AgentMail (password-reset and buyer magic-link email) | No WhatsApp Business API or templates needed |
| **Hosting** | Vercel (Next.js) + Fly.io BOM region (workers) | Edge for users, BOM for low-latency to Indian compute |
| **Storage** | Vercel Blob | Menu item photos |
| **Testing** | Vitest (unit) + Playwright (E2E — chromium + Pixel 7 mobile, `en-IN` locale, `Asia/Kolkata` timezone) | Fast unit feedback, real-browser E2E on the exact locale and timezone vendors run in |

---

## 🚀 Quickstart (local dev)

```bash
# 1. Clone + install
git clone https://github.com/gengirish/awaazos.git
cd awaazos
npm install

# 2. Copy env template, fill in your secrets
cp .env.local.example .env.local
# Required to boot: DATABASE_URL, AUTH_SECRET (set AUTH_URL too)
# Required for voice parsing: ANTHROPIC_API_KEY
# Optional server STT: OPENAI_API_KEY, GROQ_API_KEY, WHISPER_STT_URL + WHISPER_STT_SECRET
#   (SARVAM_API_KEY only matters for the dormant te/kn/ta path)
# Optional: RAZORPAY_* (incl. RAZORPAY_PLAN_STARTER_MONTHLY / _YEARLY), BLOB_READ_WRITE_TOKEN,
#   VAPID keys (Web Push), AGENTMAIL_*, SENTRY_*
# Redis: UPSTASH_REDIS_REST_* (HTTP) and REDIS_URL (TCP, BullMQ) — see "Two Redis surfaces" in CLAUDE.md
# Every variable is documented in .env.local.example

# 3. Push Prisma schema to your Neon DB (no migration files, no seed script)
npx prisma db push

# 4. Run dev server
npm run dev
# → http://localhost:3000

# 5. (Optional) Run BullMQ workers locally (voice telemetry, retention)
docker run -d --name awaazos-redis -p 6379:6379 redis:7-alpine
npm run worker  # or: npx tsx workers/index.ts
```

### Provision a Neon database

1. Sign up at https://neon.tech
2. Create project `awaazos-db` in the `aws-us-east-1` region (closest to where Vercel deploys serverless functions; switch if Vercel deploys to Mumbai)
3. Copy the **pooled** connection string → `DATABASE_URL`
4. Copy the **direct** connection string (same URL minus `-pooler` from the host) → `DIRECT_URL`

### Provision Anthropic

1. Sign up at https://console.anthropic.com
2. Create an API key, paste into `ANTHROPIC_API_KEY`
3. Default models are `claude-haiku-4-5` (primary) and `claude-sonnet-4-5` (fallback) — override with `ANTHROPIC_PRIMARY_MODEL` / `ANTHROPIC_FALLBACK_MODEL` if needed

---

## 🧪 Quality & testing

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint . (ESLint 9 flat config)
npm test            # vitest run
npm run build       # next build
npm run e2e         # playwright (uses dev server) — chromium + mobile
```

Vitest unit + Playwright E2E (chromium + Pixel 7 mobile, en-IN locale, IST timezone). See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full testing stack and what each suite guards.

> **The E2E suite writes real rows** (it registers vendors and rings up sales). Never run it against the production database or deployment; use a throwaway Postgres as shown in [`CLAUDE.md`](./CLAUDE.md#e2e-writes-real-rows--never-point-it-at-production).

---

## ☁️ Production deployment

The app is deployed across these services:

| Service | Host | What runs there |
| --- | --- | --- |
| **Web** | Vercel (`awaazos.vercel.app`) | Next.js App Router, all `/api/*` routes, marketing + vendor pages |
| **Workers** | Fly.io `awaazos-workers` (BOM region) | BullMQ workers for `voice-parse-log`, `send-receipt` (dormant Gupshup path) and retention. **The Fly app does not currently exist**; see TODO.md 1.1 |
| **Whisper STT** | Fly.io (`services/whisper-stt`) | Optional self-hosted last-resort ASR |
| **Redis (HTTP)** | Upstash REST (`UPSTASH_REDIS_*` on Vercel) | Rate limiting, idempotency, circuit breakers, monthly AI caps, `/api/ready` Redis probe |
| **Redis (TCP)** | `REDIS_URL`, a public `rediss://` endpoint | BullMQ: Vercel routes enqueue, Fly workers consume |
| **Database** | Neon Serverless Postgres (us-east-1) | All app data, `prisma.$transaction` boundaries |

The two Redis surfaces are not interchangeable; the canonical explanation is in [`CLAUDE.md`](./CLAUDE.md#deploy-topology-three-hosts-not-one).

### Deploy from scratch

Vercel deploys through its GitHub integration. [`vercel.json`](./vercel.json) skips every non-production build, so preview deployments are off and **a push to `main` is a production deploy**.

```bash
# 1. Vercel (frontend + API): connect the GitHub repo in the Vercel dashboard, then set env
vercel link
vercel env add DATABASE_URL production    # paste Neon pooled URL
vercel env add AUTH_SECRET production     # openssl rand -base64 32
vercel env add AUTH_TRUST_HOST production # value: true
vercel env add AUTH_URL production        # the public production origin
vercel env add ANTHROPIC_API_KEY production
# Upstash REST (Vercel serverless — rate limits, idempotency, /api/ready)
vercel env add UPSTASH_REDIS_REST_URL production   # https://....upstash.io
vercel env add UPSTASH_REDIS_REST_TOKEN production
# REDIS_URL: public TCP endpoint. Without it, BullMQ enqueues fail (voice telemetry is dropped).
vercel env add REDIS_URL production
# ... (add OPENAI_* / GROQ_* / WHISPER_*, RAZORPAY_*, VAPID keys, AGENTMAIL_*, BLOB_READ_WRITE_TOKEN, SENTRY_* as needed)
git push origin main   # builds and deploys production

# 2. Fly.io workers
flyctl launch --name awaazos-workers --region bom --no-deploy
# Provision Redis with a TCP URL workers can hold open (Fly Redis, or Upstash rediss://)
flyctl redis create --name awaazos-redis --org personal --region bom \
  --no-replicas --enable-eviction --enable-prodpack=false
# copy the printed URL — private Fly *.internal URLs do NOT work from Vercel
# A worker holds a TCP connection 24/7; on a pay-per-command Redis plan that bills even at zero traffic.

# DATABASE_URL + AUTH_SECRET are boot-required by lib/env.ts. GUPSHUP_* only feed the dormant
# receipt worker; the workers never call Anthropic.
flyctl secrets set --app awaazos-workers \
  REDIS_URL="rediss://..." \
  DATABASE_URL="postgresql://..." \
  AUTH_SECRET="..." \
  GUPSHUP_API_KEY="..." \
  GUPSHUP_APP_NAME="..." \
  GUPSHUP_SOURCE_NUMBER="..."

flyctl deploy --app awaazos-workers --remote-only --ha=false
```

The optional Whisper ASR service has its own Fly app and instructions in [`services/whisper-stt/README.md`](./services/whisper-stt/README.md).

### Per-deploy workflow we follow

For every meaningful change:

1. `npm test && npm run typecheck && npm run lint && npm run build` — must all pass
2. Playwright against a throwaway Postgres (see [`CLAUDE.md`](./CLAUDE.md#e2e-writes-real-rows--never-point-it-at-production)), never against production
3. `git commit -m "feat(scope): ..."` — conventional commits
4. `git push origin main` — the GitHub integration builds and deploys production; CI runs lint, typecheck, unit, build, E2E (against a CI Postgres service), gitleaks and `npm audit`

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for system diagrams, [`docs/OBSERVABILITY.md`](./docs/OBSERVABILITY.md) for production monitoring/alerting setup, [`docs/README.md`](./docs/README.md) for the index of ops docs and production controls, [`docs/DEMO_GUIDE.md`](./docs/DEMO_GUIDE.md) for live demo walkthroughs, and [`PITCH.md`](./PITCH.md) for the YC pitch.

---

## 🔐 Security

- **Secrets** — never committed; `.env.local` is gitignored. Real secrets live only in Vercel env + Fly secrets.
- **PII boundaries** — customer phone numbers are stored in Neon for re-send capability but **never sent to LLMs or STT providers**, **never logged in plaintext** (only last-4 in CSV exports / log lines).
- **Webhook auth** — Razorpay webhooks (platform and per-vendor storefront) verified via HMAC-SHA256 with `crypto.timingSafeEqual`.
- **HTTPS only** — `Strict-Transport-Security` (2 years, `includeSubDomains`, `preload`) is set in `next.config.mjs` alongside the CSP; `AUTH_TRUST_HOST=true` lets Vercel's proxy work for Auth.js.
- **Tenant isolation** — every Prisma `where` clause includes `vendorId`. Helper `requireVendorRole(role)` returns the resolved vendor and throws on cross-tenant access. CI guard recommended (not yet wired).
- **Plan gates** — `PlanGateError(402)` returns `{ code, requiredPlan, currentPlan, feature }` so the UI can render contextual upgrade CTAs.

---

## 📁 Repo structure

```
awaazos/
├── app/
│   ├── (marketing)/         landing, pricing (public)
│   ├── (auth)/              sign-in, sign-up, forgot / reset password
│   ├── (onboarding)/        first-run vendor setup
│   ├── (vendor)/            pos, menu, transactions, analytics, orders, drops, settings (hub + sections)
│   ├── admin/metrics/       platform KPIs (admin only; lib/admin-metrics.ts)
│   ├── admin/vendors/       give a store free access until a date (super admin; lib/admin-free-access.ts)
│   ├── s/[slug]/            public storefront: menu, drops, checkout, buyer order + account pages
│   ├── legal/               terms, privacy, refund, DPDP rights
│   └── api/                 ai/ (transcribe, parse-order), transactions, menu, receipts, drops,
│                            storefront-orders, s/ (buyer), push, razorpay, vendor, me, admin,
│                            webhooks/ (razorpay, razorpay-orders), health, ready
├── components/              ui/ (shadcn) plus pos, menu, transactions, analytics, storefront,
│                            drops, settings, push, receipts, billing, marketing, legal
├── hooks/useVoiceOrder.ts   mic → Web Speech or recorder → transcribe → parse-order
├── lib/                     domain + integration modules (currency, upi, rbac, anthropic, STT
│                            clients, drops, push, kv, queues, datetime, phone, …) and __tests__/
├── workers/                 BullMQ workers (voice-parse-log, receipt, retention) for Fly
├── prisma/schema.prisma     data model (applied with `prisma db push`; no migrations)
├── public/                  push service worker (sw.js) and PWA icons
├── services/whisper-stt/    optional self-hosted Whisper ASR (Python, own Fly app)
├── scripts/                 STT provider smoke tests, PWA icon generator
├── tests/golden/            LLM / ASR regression fixtures (parse-order, stt)
├── e2e/                     Playwright specs + helpers
├── src/types/               next-auth type augmentation
├── docs/                    observability, demo guide, runbooks/, archive/ (frozen April 2026 material)
├── .cursor/                 rules/*.mdc (enforced conventions) and skills/
├── .github/workflows/ci.yml lint, typecheck, unit, build, E2E, gitleaks, npm audit
├── middleware.ts            Auth.js edge middleware (imports lib/auth.config.ts only)
├── next.config.mjs          CSP + security headers, Sentry
├── vercel.json              production-only builds (no previews)
├── Dockerfile.worker, fly.toml   worker image + Fly app config (BOM)
├── CLAUDE.md                guide for contributors and coding agents
├── AGENTS.md                pointer to CLAUDE.md
├── ARCHITECTURE.md          system diagrams + data model
├── TODO.md                  open items
└── PITCH.md                 pitch + deck
```

---

## 💸 Pricing

**₹299/mo per vendor. FREE up to 50 transactions a month.**

Higher tiers come back when ≥50 vendors are paying. Plan enforcement is server-side via `requirePlan(vendor, Plan.STARTER)` returning structured `402` responses.

---

## 🤝 Contributing

This is a solo-built project today. If you're an Indian-language voice researcher, a kirana/dukaan owner who wants to be a design partner, or an engineer who wants to ship for Bharat — open an issue or DM.

For internal contributors and coding agents, the canonical guide is [`CLAUDE.md`](./CLAUDE.md). Read it before opening a PR.

---

## 👤 Founder

**Girish Hiremath** — 14+ years of enterprise software engineering across **compliance, pharma, banking, fintech, telecom, and IoT** for Fortune 500 companies. Currently **Principal Software Engineer** at a Compliance & RegTech company in Hyderabad, while pursuing an **M.Tech in Data Science & AI at IIIT Dharwad** (Institute of National Importance) — coursework includes Speech & NLP, Generative AI, Computer Vision, Financial Analytics, and AI in Healthcare.

Indic AI is a **14-year through-line**, not a 2026 hobby. First production AI project in 2012: a **Hindi Reader Android app** using OpenCV + Artificial Neural Networks at a leading semiconductor company, presented at their developer conference. AwaazOS is the natural culmination of that arc — banking-grade reliability, pharma-grade data integrity, fintech-grade payment rails, applied to a problem only an Indian engineer who's lived through paper bills at a chai stall can really see clearly.

| | |
| --- | --- |
| 🌐 Portfolio | https://girishbhiremath.vercel.app |
| 📧 Email | gen.girish@gmail.com |
| 💼 LinkedIn | [linkedin.com/in/girishbhiremath](https://www.linkedin.com/in/girishbhiremath) |
| 🐙 GitHub | [github.com/gengirish](https://github.com/gengirish) |

---

## 🏢 Built by IntelliForge AI

AwaazOS is a flagship product of **[IntelliForge AI](https://www.intelliforge.tech)** — a Hyderabad-based AI engineering studio.

| | |
| --- | --- |
| 🌐 Site | https://www.intelliforge.tech |
| 📧 Contact | contact@intelliforge.tech |
| 📍 Location | Hyderabad, Telangana, India |

---

## 📄 License

Proprietary. © 2026 AwaazOS · IntelliForge AI. Code published for transparency, not for redistribution. Reach out at **contact@intelliforge.tech** for licensing, partnership, or design-partner inquiries.

---

## 🇮🇳 Acknowledgements

Built for the chai-wala in Hyderabad, the dosa cart in Bengaluru, the kirana shop in Indore, and the paan stall in Kolkata. **Bol. Bill. Becho.**
