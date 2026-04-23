# AwaazOS — Bol. Bill. Becho.

> **Voice-first POS + digital billing for India's 60 million small vendors.**
> Speak the order in any Indian language → instant UPI QR → WhatsApp receipt → live sales dashboard. ₹0 to start.

[![Live](https://img.shields.io/badge/live-awaazos.vercel.app-brightgreen)](https://awaazos.vercel.app)
[![Stack](https://img.shields.io/badge/stack-Next.js%2014%20%C2%B7%20Auth.js%20%C2%B7%20Neon%20%C2%B7%20Claude%204.5-blueviolet)](#-tech-stack)
[![Tests](https://img.shields.io/badge/tests-51%20unit%20%C2%B7%2038%20E2E-success)](#-quality--testing)
[![License](https://img.shields.io/badge/license-proprietary-lightgrey)](#-license)

---

## 🌐 Live demo

| Surface | URL |
| --- | --- |
| **Production app** | https://awaazos.vercel.app |
| **Pricing** | https://awaazos.vercel.app/pricing |
| **Sign up** | https://awaazos.vercel.app/sign-up |
| **GitHub** | https://github.com/gengirish/awaazos |

> 60-second test: sign up → onboard a stall → add 3 menu items → open `/pos` on your phone → tap the orange mic → say _"do samosa aur ek chai"_ → see the cart fill → scan the UPI QR → bill `AWZ-YYYYMMDD-0001` is generated atomically → check `/analytics`.

---

## 🌶️ The problem

India has **63 million MSMEs** and **~25 million micro-merchants** — chai walas, dosa carts, kirana shops, samosa stalls, paan shops. They:

- Take orders verbally in Hindi / Telugu / Kannada / Tamil / Marathi / Bengali (rarely in English)
- Hand-write bills on paper or skip billing entirely (lose 15-20% of revenue to inventory leakage and disputes)
- Accept UPI but can't tie payments to orders
- Have no idea which item sold most, what their busiest hour is, or how much they actually made today
- Can't afford ₹2,000-5,000/mo POS systems built for English-speaking, literate restaurant managers

**The gap**: existing POS software (Petpooja, Zomato Hub, Square clones) assumes a manager-class user who can type, navigate menus, and trust an English UI. That cuts out 90% of India's actual point-of-sale.

## 💡 The solution

A POS where **the only interface is your voice and your eyes**.

1. Vendor speaks the order in their language → AwaazOS transcribes (Sarvam Saaras v2 for Indic, Web Speech for en/hi)
2. Claude Haiku 4.5 parses the transcript against this vendor's exact menu (with prompt caching) and emits structured items via tool-use
3. Cart fills, total computes in paise (no float math, ever)
4. Vendor taps **Collect Payment** → big UPI QR code → customer scans with GPay / PhonePe / Paytm
5. Mark as paid → atomic bill number `AWZ-20260423-0001` → DB transaction commits → WhatsApp receipt enqueued
6. Owner sees real-time dashboards (revenue trend, top sellers, hourly heatmap, voice adoption %)

All of this on a phone, in <8 seconds per transaction, in **any of 22 official Indian languages**.

---

## ✨ Features

### Built and shipped (Phase 0–4 complete)

- 🎙️ **Voice-first POS** — 80×80 mic button, 6 visual states (idle / listening / transcribing / parsing / success / error), distinguishable beyond color, full `aria-live` for screen readers
- 🌍 **Multilingual STT routing** — Web Speech for English & Hindi, Sarvam Saaras v2 for Telugu / Kannada / Tamil / Marathi / Bengali
- 🧠 **Two-tier AI parsing** — Claude Haiku 4.5 primary with ephemeral prompt caching on the menu, escalates to Sonnet 4.5 only on low confidence (~80% cost savings vs always-Sonnet)
- 💰 **Integer-paise math everywhere** — no `parseFloat`, no `toFixed` (single exception: UPI deep-link `am=` per spec)
- 🔢 **Atomic bill numbering** — `AWZ-YYYYMMDD-NNNN` via `BillSequence.upsert` inside `prisma.$transaction`, race-safe across concurrent sales
- 📲 **WhatsApp receipts** — Gupshup REST + BullMQ background queue + idempotent worker, customer phone PII-protected (never logged, only last-4 in CSV exports)
- 💳 **UPI deep links + QR** — vendor's own UPI ID, no MDR fees, scannable from any UPI app
- 📊 **Analytics dashboard** — Recharts revenue trend, hourly heatmap (raw SQL `EXTRACT HOUR AT TIME ZONE 'Asia/Kolkata'`), top 10 sellers, voice adoption %, payment method breakdown — every chart has a `<details>` data table for accessibility
- 🏢 **Multi-tenant** — `vendorId` scoping enforced on every query, two-layer RBAC (platform `UserRole` + per-tenant `StaffRole`)
- 💸 **Razorpay subscriptions** — FREE / STARTER ₹299 / PRO ₹799 / ENTERPRISE custom, plan gates with `PlanGateError(402)` returning structured upgrade prompts
- 🇮🇳 **India-first defaults** — IST timezone, DD/MM/YYYY dates, `+91` 10-digit phone validation, `Intl.NumberFormat('en-IN', { currency: 'INR' })`, `libphonenumber-js`
- 🔐 **Auth.js v5 (NextAuth)** — Edge-split config, JWT sessions, Credentials provider with bcrypt, single `prisma.$transaction` for sign-up
- 🎨 **Mobile-first UI** — Tailwind + shadcn/ui, saffron AwaazOS palette (`--awaaz-orange` AA-contrast), Baloo 2 + Nunito Indic-friendly fonts
- ✅ **51 unit tests + 38 E2E** — Vitest + Playwright (chromium + Pixel 7 mobile, en-IN locale, IST timezone)

### Roadmap (Phase 5+)

- Inventory tracking with auto-deduct on sale
- Multi-staff shift management + per-staff sales attribution
- GST invoice mode for vendors with GSTIN
- WhatsApp Business *menu sharing* — customer browses + orders via WhatsApp chat
- Vernacular receipts (currently English; Hindi/Indic on roadmap)
- Dukaan Network — vendor-to-vendor inventory marketplace
- Offline-first PWA (current app is online-only)

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
| **STT** | Sarvam Saaras v2 (Indic) + Web Speech API (en/hi) | Sarvam best for Indian languages; Web Speech free for browser-native |
| **Background jobs** | BullMQ + Upstash Redis (via Fly.io) | Receipt sending, voice telemetry, retries with backoff |
| **Payments** | Razorpay subscriptions + payment links | India-first, supports UPI / cards / wallets / EMI |
| **Messaging** | Gupshup WhatsApp Business API | Cheapest verified WABA channel for India |
| **Hosting** | Vercel (Next.js) + Fly.io BOM region (workers) | Edge for users, BOM for low-latency to Indian compute |
| **Storage** | Vercel Blob | Vendor logos, future menu item photos |
| **Testing** | Vitest (unit) + Playwright (E2E) + axe-core (a11y) | Fast unit, real-browser E2E, accessibility CI |

---

## 🚀 Quickstart (local dev)

```bash
# 1. Clone + install
git clone https://github.com/gengirish/awaazos.git
cd awaazos
npm install

# 2. Copy env template, fill in your secrets
cp .env.local.example .env.local
# Required to boot: DATABASE_URL, AUTH_SECRET
# Required for voice: ANTHROPIC_API_KEY (and SARVAM_API_KEY for non-en/hi)
# Optional: RAZORPAY_*, GUPSHUP_*, REDIS_URL, BLOB_READ_WRITE_TOKEN

# 3. Push Prisma schema to your Neon DB
npx prisma db push

# 4. Run dev server
npm run dev
# → http://localhost:3000

# 5. (Optional) Run BullMQ workers locally for WhatsApp receipts
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
npm run typecheck   # tsc --noEmit                — 0 errors
npm run lint        # next lint                   — 0 warnings/errors
npm test            # vitest run                  — 51 passed (12 files)
npm run build       # next build                  — 25 routes, all green
npm run e2e         # playwright (uses dev server) — chromium + mobile
BASE_URL=https://awaazos.vercel.app npm run e2e   # E2E against prod
```

### Test coverage today

| Suite | Cases | What it covers |
| --- | --- | --- |
| `currency.test.ts` | 3 | Paise ↔ rupee conversion, sumPaise integer guarantees |
| `upi.test.ts` | 3 | UPI deep-link spec compliance (`pa`, `pn`, `am`, `cu=INR`, `tn`) |
| `zod-menu.test.ts` | 8 | Menu CRUD body validation (price > 0, name length, category enum) |
| `anthropic.test.ts` | 6 | Hindi numeral normalization, Telugu numbers, off-menu detection, escalation logic |
| `razorpay-signature.test.ts` | 4 | HMAC-SHA256 webhook verification with `timingSafeEqual` |
| `rbac-plan.test.ts` | 3 | `requirePlan` PlanGateError(402) with structured upgrade body |
| `cartStore.test.ts` | 6 | Zustand cart math, voice-merge duplicates, qty 0 = remove |
| `billing-period.test.ts` | 3 | IST midnight pinning, YYYYMMDD bill date, month-start |
| `transaction-validation.test.ts` | 4 | Server-side recompute of subtotal + total, rejects mismatches |
| `billsequence.test.ts` | 1 | Atomicity proof — `tx.billSequence.upsert` runs inside `$transaction` |
| `whatsapp-message.test.ts` | 2 | Receipt formatter (multiline, India-friendly, AwaazOS footer) |
| `analytics-aggregations.test.ts` | 9 | KPI sums, voice adoption %, plan-history clamping |
| **e2e/public.spec.ts** | 19 × 2 browsers | Public surfaces render, all 7 protected pages redirect to /sign-in, all 8 protected APIs return 3xx/4xx |

---

## ☁️ Production deployment

The app is deployed today across two providers:

| Service | Host | What runs there |
| --- | --- | --- |
| **Web** | Vercel (`awaazos.vercel.app`) | Next.js App Router, all `/api/*` routes, marketing + vendor pages |
| **Workers** | Fly.io `awaazos-workers` (BOM region) | BullMQ workers for `voiceLog` + `send-receipt` queues |
| **Redis** | Fly.io Upstash `awaazos-redis` (BOM) | BullMQ queue backend |
| **Database** | Neon Serverless Postgres (us-east-1) | All app data, `prisma.$transaction` boundaries |

### Deploy from scratch

```bash
# 1. Vercel (frontend + API)
vercel link
vercel env add DATABASE_URL production    # paste Neon pooled URL
vercel env add AUTH_SECRET production     # openssl rand -base64 32
vercel env add AUTH_TRUST_HOST production # value: true
vercel env add ANTHROPIC_API_KEY production
# ... (add SARVAM_*, RAZORPAY_*, GUPSHUP_*, REDIS_URL, BLOB_READ_WRITE_TOKEN as needed)
vercel --prod

# 2. Fly.io workers
flyctl launch --name awaazos-workers --region bom --no-deploy
flyctl redis create --name awaazos-redis --org personal --region bom \
  --no-replicas --enable-eviction --enable-prodpack=false
# copy the printed redis:// URL

flyctl secrets set --app awaazos-workers \
  REDIS_URL="redis://..." \
  DATABASE_URL="postgresql://..." \
  ANTHROPIC_API_KEY="..." \
  GUPSHUP_API_KEY="..." \
  GUPSHUP_SOURCE_NUMBER="..." \
  AUTH_SECRET="..."

flyctl deploy --app awaazos-workers --remote-only --ha=false

# 3. Sync REDIS_URL back to Vercel so /api/* can enqueue jobs
echo "redis://..." | vercel env add REDIS_URL production
vercel --prod
```

### Per-deploy workflow we follow

For every meaningful change:

1. `npm test && npm run typecheck && npm run lint && npm run build` — must all pass
2. `git add -A && git commit -m "feat(scope): ..."` — conventional commits
3. `git push origin main` — GitHub integration auto-builds Vercel
4. `vercel --prod --yes` — explicit CLI prod deploy for synchronous URL
5. `BASE_URL=https://awaazos.vercel.app npx playwright test` — E2E against live

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for system diagrams and [`PITCH.md`](./PITCH.md) for the YC pitch.

---

## 🔐 Security

- **Secrets** — never committed; `.env.local` is gitignored. Real secrets live only in Vercel env + Fly secrets.
- **PII boundaries** — customer phone numbers are stored in Neon for re-send capability but **never sent to LLMs or STT providers**, **never logged in plaintext** (only last-4 in CSV exports / log lines).
- **Webhook auth** — Razorpay webhooks verified via HMAC-SHA256 with `crypto.timingSafeEqual`.
- **HTTPS only** — middleware enforces; `AUTH_TRUST_HOST=true` lets Vercel's proxy work for Auth.js.
- **Tenant isolation** — every Prisma `where` clause includes `vendorId`. Helper `requireVendorRole(role)` returns the resolved vendor and throws on cross-tenant access. CI guard recommended (not yet wired).
- **Plan gates** — `PlanGateError(402)` returns `{ code, requiredPlan, currentPlan, feature }` so the UI can render contextual upgrade CTAs.

---

## 📁 Repo structure

```
awaazos/
├── app/
│   ├── (marketing)/         landing, pricing — public
│   ├── (auth)/              sign-in, sign-up
│   ├── (onboarding)/        first-run vendor setup
│   ├── (vendor)/            menu, pos, transactions, analytics, settings
│   └── api/
│       ├── auth/[...nextauth]/  Auth.js v5
│       ├── menu/                CRUD
│       ├── transactions/        atomic bill creation + list + CSV export
│       ├── receipts/send/       enqueue WhatsApp receipt
│       ├── ai/parse-order/      Claude two-tier NLU
│       ├── ai/transcribe/       Sarvam STT (plan-gated)
│       ├── razorpay/            subscription create / cancel
│       └── webhooks/razorpay/   HMAC-verified webhook handler
├── components/
│   ├── ui/                  shadcn primitives
│   ├── marketing/           Hero, HowItWorks, Features, PricingTeaser
│   ├── menu/                MenuGrid, MenuItemForm
│   ├── pos/                 PosShell, VoiceOrderButton (80×80), QuickAddGrid, OrderCart, UpiQRModal, ReceiptModal
│   ├── transactions/        TransactionsTable, TransactionDetailDrawer
│   ├── analytics/           AnalyticsDashboard, RevenueTrendChart, HourlyHeatmap, TopItemsList, VoiceAdoptionCard, PaymentMethodBreakdown
│   └── billing/             SubscriptionGate, PricingPlanButtons
├── lib/
│   ├── auth.ts / auth.config.ts   Auth.js v5 split (edge + node)
│   ├── prisma.ts                  PrismaClient singleton
│   ├── env.ts                     Zod-validated env (boot-required vs feature-gated)
│   ├── rbac.ts                    requireVendorRole, requirePlan, AuthError, PlanGateError
│   ├── currency.ts                paise math (formatINR, paiseToRupees, sumPaise)
│   ├── upi.ts                     UPI deep-link + QR builder (sole toFixed exception)
│   ├── billing-period.ts          IST date helpers, AWZ-YYYYMMDD-NNNN formatter
│   ├── anthropic.ts               Claude two-tier client + prompt caching + tool-use
│   ├── sarvam.ts                  Saaras v2 STT client + AbortController timeout
│   ├── razorpay.ts                Lazy singleton + HMAC verifier
│   ├── whatsapp.ts + whatsapp-message.ts  Gupshup REST + receipt formatter
│   ├── queues.ts                  BullMQ queue accessors (lazy Redis)
│   ├── cartStore.ts               Zustand POS cart
│   ├── analytics-aggregations.ts  Pure helpers (KPI sums, plan clamp)
│   ├── zod-auth.ts / zod-menu.ts / transaction-post-body.ts  Zod schemas
│   └── __tests__/                 Vitest unit tests
├── workers/
│   ├── index.ts                   BullMQ entrypoint
│   ├── voiceLog.worker.ts         persists voice telemetry
│   └── receipt.worker.ts          sends WhatsApp via Gupshup, idempotent
├── prisma/schema.prisma
├── e2e/public.spec.ts             Playwright suite
├── middleware.ts                  Auth.js edge middleware
├── playwright.config.ts
├── vitest.config.ts
├── tailwind.config.ts             Saffron palette + Indic fonts
├── Dockerfile.worker              Multi-stage Node 20 alpine for Fly
├── fly.toml                       BOM region, 512MB
├── .vercelignore                  excludes workers/ from Vercel
├── .cursor/rules/*.mdc            9 project rules (india-locale, money, tenant-isolation, ...)
├── .cursor/skills/                project-local agent skills
├── AGENTS.md                      orientation for AI coding agents
├── awaazos-cursor-prompt.md       authoritative product spec (1300+ lines)
├── ARCHITECTURE.md                system diagrams + data model
└── PITCH.md                       YC pitch + 10-slide deck
```

---

## 💸 Pricing

| Plan | Price/mo | Voice languages | Monthly txns | WhatsApp | Analytics history | CSV export |
| --- | ---: | --- | ---: | --- | --- | --- |
| **FREE** | ₹0 | Web Speech (en/hi) | 50 | — | 7 days | — |
| **STARTER** | ₹299 | + Sarvam (te/kn/ta/mr/bn) | 500 | ✅ | 90 days | — |
| **PRO** | ₹799 | + Sarvam | Unlimited | ✅ | 365 days | ✅ |
| **ENTERPRISE** | Custom | + Sarvam | Unlimited | ✅ | Unlimited | ✅ |

Plan enforcement is server-side via `requirePlan(vendor, Plan.STARTER)` returning structured `402` responses.

---

## 🤝 Contributing

This is a solo-built project today. If you're an Indian-language voice researcher, a kirana/dukaan owner who wants to be a design partner, or an engineer who wants to ship for Bharat — open an issue or DM.

For internal contributors, the canonical agent guide is [`AGENTS.md`](./AGENTS.md). Read it before opening a PR.

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

AwaazOS is a flagship product of **[IntelliForge AI](https://www.intelliforge.tech)** — a Hyderabad-based AI engineering studio specializing in **AI agent development, workflow automation, and AI app development**, aligned with the **Bharat AI Mission** (India's ₹10,372 Cr IndiaAI initiative).

IntelliForge ships across a **5-Level AI framework**:

| Level | Focus | Where AwaazOS sits |
| --- | --- | --- |
| 1 | AI Foundations & Training | — |
| 2 | AI Workflow Automation | — |
| 3 | AI Creative Studio | — |
| 4 | AI Agent Development | Receipt + voice-log workers |
| **5** | **AI App Development** | **AwaazOS — production Next.js + Auth.js + Claude pipeline** |

AwaazOS is **the proof** that the studio's 5-level framework ships real, working production software for India — not slideware. Other IntelliForge projects include Multi-Agent Deep Research, Interview Bot (AI hiring), MoveMore (AI wellness), AI Digital Profile, and several open automation tools.

| | |
| --- | --- |
| 🌐 Site | https://www.intelliforge.tech |
| 📧 Contact | contact@intelliforge.tech |
| 📍 Location | Hyderabad, Telangana, India |
| 🇮🇳 Mission | Aligned with Bharat AI Mission — democratizing AI for Tier-I, II, and III India |

---

## 📄 License

Proprietary. © 2026 AwaazOS · IntelliForge AI. Code published for transparency, not for redistribution. Reach out at **contact@intelliforge.tech** for licensing, partnership, or design-partner inquiries.

---

## 🇮🇳 Acknowledgements

Built for the chai-wala in Hyderabad, the dosa cart in Bengaluru, the kirana shop in Indore, and the paan stall in Kolkata. **Bol. Bill. Becho.**
