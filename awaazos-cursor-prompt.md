# AwaazOS — Cursor Kickoff Prompt
## An IntelliForge AI Product
### AI Voice-Powered Billing & UPI Payment Platform for Indian Vendors

**Tagline:** "Bol. Bill. Becho." *(Speak. Bill. Sell.)*
**Domain:** `awaazos.in` / `awaazos.intelliforge.tech`
**GitHub:** `github.com/gengirish/awaazos`

---

## 🎯 PRODUCT VISION

**AwaazOS** is a multi-tenant, voice-first Point-of-Sale (POS) and digital billing SaaS
built for the 63 million+ Indian small vendors — carnival stalls, street food vendors,
school canteens, event pop-ups, mela traders, kirana shops, and weekend market sellers.

The name comes from **Awaaz** (आवाज़) — the Hindi/Urdu word for *Voice* — reflecting the
core AI differentiator: speak your order in any Indian language, get a bill in seconds,
collect payment via UPI QR.

**Aligned with Bharat AI Mission** — democratizing AI-native commerce for Tier II/III India.

### Core Differentiators
- 🎤 **Voice-First AI Ordering** — Claude AI parses "do bhel aur ek nimbu pani" → auto-bill
- 🌐 **Multilingual** — en-IN, hi-IN, te-IN, kn-IN, ta-IN voice support
- 📲 **Instant UPI QR** — per-transaction QR for GPay / PhonePe / Paytm
- 🧾 **WhatsApp Receipts** — send digital receipt via Gupshup instantly
- 📊 **Real-Time Sales Dashboard** — daily/weekly/monthly earnings analytics
- 🏪 **Multi-Tenant** — each vendor = isolated workspace, own menu + UPI ID + branding
- 💰 **India-First Pricing** — ₹0 free tier, ₹299 Starter, ₹799 Pro

---

## 🛠 TECH STACK

```
Frontend:       Next.js 14 App Router (TypeScript, strict mode)
Styling:        Tailwind CSS + shadcn/ui
Auth:           Auth.js v5 (NextAuth) + @auth/prisma-adapter + bcryptjs
                Credentials provider · JWT sessions · two-layer RBAC
                (platform UserRole · per-tenant StaffRole on Vendor)
Database:       Neon (Serverless PostgreSQL)
                — pooled URL for app runtime, direct URL for prisma migrate
                — @neondatabase/serverless driver available for edge routes
ORM:            Prisma (with neonConfig.fetchConnectionCache for cold starts)
AI (NLU):       Claude Haiku 4.5 (primary parser) + Claude Sonnet 4.5 (fallback)
                Anthropic prompt caching enabled for menu context (≥90% input discount)
Voice Input:    Web Speech API for en-IN, hi-IN (free, browser-native)
                Sarvam Saaras v2 STT for te-IN, kn-IN, ta-IN (Web Speech is unreliable here)
Payments:       Razorpay (SaaS subscription billing + payment links)
UPI QR:         api.qrserver.com (free) + Razorpay Payment Links (pro)
Background:     BullMQ + Redis (WhatsApp receipt jobs, analytics aggregation)
WhatsApp:       Gupshup API (receipt + notification delivery)
Storage:        Vercel Blob (logos, PDF receipts) — colocated with Vercel deploy
Deploy:         Vercel (frontend + API routes) + Fly.io (BullMQ workers)
Analytics:      Recharts (vendor dashboard)
State:          Zustand (POS cart state)
Forms:          React Hook Form + Zod
```

---

## 📁 FULL PROJECT STRUCTURE

```
awaazos/
├── app/
│   ├── (marketing)/
│   │   ├── page.tsx                        # Landing — "Bol. Bill. Becho."
│   │   ├── pricing/page.tsx                # ₹0 / ₹299 / ₹799 plans
│   │   └── features/page.tsx
│   ├── (auth)/
│   │   ├── sign-in/page.tsx                # Custom Auth.js Credentials form
│   │   └── sign-up/page.tsx                # Calls /api/auth/register then signIn()
│   ├── (onboarding)/
│   │   └── onboarding/page.tsx             # UPI ID + stall type + first menu items
│   ├── (vendor)/
│   │   ├── layout.tsx                      # Sidebar + header + subscription gate
│   │   ├── dashboard/page.tsx              # Sales KPIs + today's revenue
│   │   ├── pos/page.tsx                    # ⭐ Main voice billing screen
│   │   ├── menu/
│   │   │   ├── page.tsx                    # Menu item list
│   │   │   └── [id]/page.tsx               # Edit menu item
│   │   ├── transactions/
│   │   │   ├── page.tsx                    # Transaction history + filters
│   │   │   └── [id]/page.tsx               # Transaction detail + receipt
│   │   ├── analytics/page.tsx              # Revenue charts + top items
│   │   ├── receipts/page.tsx               # All receipts sent
│   │   └── settings/
│   │       ├── page.tsx                    # UPI ID, branding, WhatsApp number
│   │       ├── billing/page.tsx            # Razorpay subscription management
│   │       └── staff/page.tsx              # Add cashier staff (Pro plan)
│   └── api/
│       ├── auth/
│       │   ├── [...nextauth]/route.ts      # Auth.js handlers (GET, POST)
│       │   └── register/route.ts           # POST: create User + Vendor + Staff(OWNER) in one tx
│       ├── ai/
│       │   ├── parse-order/route.ts        # POST: Claude voice order parser
│       │   └── transcribe/route.ts         # POST: audio multipart → Sarvam STT (te/kn/ta)
│       ├── upi/
│       │   ├── generate-qr/route.ts        # POST: Generate UPI QR URL
│       │   └── payment-link/route.ts       # POST: Razorpay Payment Link (Pro)
│       ├── transactions/
│       │   ├── route.ts                    # GET list, POST create
│       │   └── [id]/route.ts               # GET, PATCH, DELETE
│       ├── menu/
│       │   ├── route.ts                    # GET list, POST create
│       │   └── [id]/route.ts               # GET, PATCH, DELETE
│       ├── receipts/
│       │   └── send/route.ts               # POST: WhatsApp receipt via Gupshup
│       ├── analytics/
│       │   ├── daily/route.ts              # GET: daily revenue summary
│       │   └── top-items/route.ts          # GET: best-selling items
│       ├── vendor/
│       │   └── route.ts                    # GET, PATCH vendor profile
│       └── webhooks/
│           └── razorpay/route.ts           # POST: payment confirmation webhook
├── components/
│   ├── pos/
│   │   ├── VoiceOrderButton.tsx            # Mic button + Web Speech API + pulsing UI
│   │   ├── OrderCart.tsx                   # Live bill with qty +/- and remove
│   │   ├── QuickAddGrid.tsx                # Manual menu tap grid (fallback)
│   │   ├── UpiQRModal.tsx                  # QR code display + payment status
│   │   ├── ReceiptModal.tsx                # Print / WhatsApp receipt sender
│   │   └── BillSummary.tsx                 # Total + tax + discount display
│   ├── menu/
│   │   ├── MenuItemCard.tsx
│   │   └── MenuItemForm.tsx                # Create/edit with emoji picker
│   ├── analytics/
│   │   ├── RevenueChart.tsx                # Recharts area chart — daily revenue
│   │   ├── TopItemsChart.tsx               # Horizontal bar — best sellers
│   │   └── StatCard.tsx                    # KPI cards (today ₹, txn count, avg)
│   ├── onboarding/
│   │   └── OnboardingWizard.tsx            # 4-step setup flow
│   └── shared/
│       ├── AppShell.tsx                    # Sidebar + mobile nav
│       ├── SubscriptionGate.tsx            # Plan check wrapper
│       └── AwaazLogo.tsx                   # Brand logo with आवाज़ wordmark
├── lib/
│   ├── anthropic.ts                        # Claude clients (Haiku + Sonnet) + tool-use helpers
│   ├── sarvam.ts                           # Sarvam Saaras STT client (te/kn/ta)
│   ├── prisma.ts                           # Prisma client singleton (Neon-pooled)
│   ├── blob.ts                             # Vercel Blob upload helpers (logos, PDFs)
│   ├── razorpay.ts                         # Razorpay client
│   ├── gupshup.ts                          # WhatsApp API client
│   ├── upi.ts                              # UPI deep link + QR URL builder
│   ├── voice.ts                            # Web Speech API hook (useVoiceOrder)
│   ├── currency.ts                         # Paise ↔ ₹ formatters (en-IN)
│   ├── auth.ts                             # NextAuth() + adapter + Credentials + requireUser()
│   ├── auth.config.ts                      # Edge-safe NextAuthConfig (used by middleware)
│   ├── rbac.ts                             # requirePlatformRole, requireVendorRole, AuthError
│   ├── password.ts                         # bcrypt hash/verify (rounds = 12)
│   └── zod-auth.ts                         # signInSchema, signUpSchema
├── hooks/
│   ├── useVoiceOrder.ts                    # Mic → transcript → Claude → cart
│   ├── useCart.ts                          # Zustand cart state
│   ├── useVendor.ts                        # Current vendor context
│   └── useAnalytics.ts                     # SWR analytics fetcher
├── store/
│   └── cartStore.ts                        # Zustand store for POS cart
├── prisma/
│   └── schema.prisma
├── workers/
│   ├── receipt.worker.ts                   # BullMQ: WhatsApp receipt delivery
│   └── voiceLog.worker.ts                  # BullMQ: VoiceParseLog persistence (off API path)
├── types/
│   ├── index.ts                            # Shared app types
│   └── next-auth.d.ts                      # Module augmentation for Session/User/JWT
├── middleware.ts                           # NextAuth(authConfig) — edge-safe
├── .cursor/
│   └── rules/                              # Per-folder .mdc rules (see "Rules layout" below)
├── .env.local.example
└── CURSOR_PLAYBOOK.md
```

---

## 🗄 PRISMA SCHEMA

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}

// ─── VENDOR (Tenant) ────────────────────────────────────────────────

model Vendor {
  id              String      @id @default(cuid())
  slug            String      @unique                 // URL-safe handle, e.g. "ravis-bhel"
  name            String                              // Stall/shop name
  ownerName       String
  phone           String?                             // +91 format
  email           String?
  upiId           String?                             // e.g. vendor@okaxis
  upiName         String?                             // Name shown on UPI screen
  logoUrl         String?                             // Vercel Blob URL
  plan            Plan        @default(FREE)
  planExpiresAt   DateTime?
  stallType       StallType   @default(GENERAL)
  city            String?
  state           String      @default("Telangana")
  gstin           String?                             // 15-char GST identifier (optional)
  isActive        Boolean     @default(true)
  onboardingDone  Boolean     @default(false)
  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt

  menuItems       MenuItem[]
  transactions    Transaction[]
  receipts        Receipt[]
  staff           StaffMember[]
  settings        VendorSettings?
  dailySummaries  DailySummary[]
  billSequences   BillSequence[]
  voiceParseLogs  VoiceParseLog[]

  @@index([slug])
  @@map("vendors")
}

model VendorSettings {
  id                    String   @id @default(cuid())
  vendorId              String   @unique
  vendor                Vendor   @relation(fields: [vendorId], references: [id], onDelete: Cascade)
  sendWhatsappReceipt   Boolean  @default(false)
  autoPrintReceipt      Boolean  @default(false)
  taxEnabled            Boolean  @default(false)
  taxPercent            Decimal  @default(0)   @db.Decimal(5, 2)
  discountEnabled       Boolean  @default(false)
  whatsappNumber        String?                // +91XXXXXXXXXX
  voiceLang             String   @default("en-IN")   // hi-IN, te-IN, kn-IN, ta-IN
  receiptFooter         String?                // "Thanks for visiting!"
  theme                 String   @default("orange")  // orange | green | blue | purple
  hsnDefault            String?                // Default HSN/SAC code for menu items without one
  razorpaySubId         String?
  razorpayCustomerId    String?

  @@map("vendor_settings")
}

// ─── MENU ───────────────────────────────────────────────────────────

model MenuItem {
  id            String      @id @default(cuid())
  vendorId      String
  vendor        Vendor      @relation(fields: [vendorId], references: [id], onDelete: Cascade)
  name          String                              // Display name
  aliases       String[]    @default([])            // Voice recognition aliases (e.g. ["bhel", "lays bhel"])
  emoji         String      @default("🍽️")
  category      String      @default("General")
  priceInPaise  Int                                 // ALWAYS store in paise. ₹20 = 2000
  isAvailable   Boolean     @default(true)
  isPopular     Boolean     @default(false)
  sortOrder     Int         @default(0)
  imageUrl      String?
  hsnCode       String?                             // HSN/SAC; falls back to VendorSettings.hsnDefault
  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt

  orderItems    OrderItem[]

  @@index([vendorId, isAvailable])
  @@map("menu_items")
}

// ─── TRANSACTION ────────────────────────────────────────────────────

model Transaction {
  id                  String          @id @default(cuid())
  vendorId            String
  vendor              Vendor          @relation(fields: [vendorId], references: [id], onDelete: Cascade)
  billNumber          String                          // AWZ-20260502-0001 (auto-generated)
  subtotalPaise       Int
  discountPaise       Int             @default(0)
  taxPaise            Int             @default(0)
  totalPaise          Int                             // subtotal - discount + tax
  paymentMethod       PaymentMethod   @default(UPI)
  paymentStatus       PaymentStatus   @default(PENDING)
  upiRef              String?                         // Customer's UTR reference
  razorpayOrderId     String?
  razorpayPaymentId   String?
  paymentLinkUrl      String?                         // Razorpay Payment Link URL
  customerPhone       String?                         // +91 for WhatsApp receipt
  customerName        String?
  voiceTranscript     String?                         // Raw voice input
  source              OrderSource     @default(VOICE)
  notes               String?
  paidAt              DateTime?
  createdAt           DateTime        @default(now())
  updatedAt           DateTime        @updatedAt

  orderItems          OrderItem[]
  receipt             Receipt?

  @@index([vendorId, createdAt])
  @@index([vendorId, paymentStatus])
  @@index([billNumber])
  @@map("transactions")
}

model OrderItem {
  id            String       @id @default(cuid())
  transactionId String
  transaction   Transaction  @relation(fields: [transactionId], references: [id], onDelete: Cascade)
  menuItemId    String?
  menuItem      MenuItem?    @relation(fields: [menuItemId], references: [id])
  name          String                               // Snapshot at time of sale
  priceInPaise  Int
  qty           Int          @default(1)
  totalPaise    Int                                  // priceInPaise * qty

  @@index([transactionId])
  @@map("order_items")
}

// ─── RECEIPT ────────────────────────────────────────────────────────

model Receipt {
  id              String       @id @default(cuid())
  transactionId   String       @unique
  transaction     Transaction  @relation(fields: [transactionId], references: [id], onDelete: Cascade)
  vendorId        String
  vendor          Vendor       @relation(fields: [vendorId], references: [id])
  receiptNumber   String
  whatsappSent    Boolean      @default(false)
  whatsappSentAt  DateTime?
  deliveredTo     String?                            // +91 phone number
  pdfUrl          String?                            // Vercel Blob URL
  createdAt       DateTime     @default(now())

  @@index([vendorId, createdAt])
  @@map("receipts")
}

// ─── DAILY SUMMARY (pre-aggregated for fast dashboard) ─────────────

model DailySummary {
  id                String   @id @default(cuid())
  vendorId          String
  vendor            Vendor   @relation(fields: [vendorId], references: [id], onDelete: Cascade)
  date              DateTime @db.Date                // YYYY-MM-DD
  totalRevenuePaise Int      @default(0)
  totalTransactions Int      @default(0)
  totalItemsSold    Int      @default(0)
  cashRevenuePaise  Int      @default(0)
  upiRevenuePaise   Int      @default(0)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@unique([vendorId, date])
  @@index([vendorId, date])
  @@map("daily_summaries")
}

// ─── STAFF ──────────────────────────────────────────────────────────

model StaffMember {
  id            String    @id @default(cuid())
  vendorId      String
  vendor        Vendor    @relation(fields: [vendorId], references: [id], onDelete: Cascade)
  userId        String
  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  name          String
  phone         String?
  role          StaffRole @default(CASHIER)
  isActive      Boolean   @default(true)
  createdAt     DateTime  @default(now())

  @@unique([vendorId, userId])
  @@index([userId])
  @@map("staff_members")
}

// ─── AUTH.JS v5 ─────────────────────────────────────────────────────
// Standard adapter tables. @db.Text on OAuth token columns prevents
// Postgres truncation on long Google ID tokens.

model User {
  id            String        @id @default(cuid())
  name          String?
  email         String        @unique
  emailVerified DateTime?
  image         String?
  passwordHash  String?                             // null for OAuth-only users
  role          UserRole      @default(USER)
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt

  accounts      Account[]
  sessions      Session[]
  staffMemberships StaffMember[]

  @@index([email])
  @@map("users")
}

model Account {
  id                String  @id @default(cuid())
  userId            String
  user              User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  type              String
  provider          String
  providerAccountId String
  refresh_token     String? @db.Text
  access_token      String? @db.Text
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String? @db.Text
  session_state     String?

  @@unique([provider, providerAccountId])
  @@map("accounts")
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  expires      DateTime

  @@map("sessions")
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
  @@map("verification_tokens")
}

// ─── BILL SEQUENCE (atomic per-vendor-per-day counter) ─────────────
// Used to generate AWZ-YYYYMMDD-NNNN deterministically without count() races.

model BillSequence {
  vendorId  String
  vendor    Vendor   @relation(fields: [vendorId], references: [id], onDelete: Cascade)
  date      DateTime @db.Date
  lastSeq   Int      @default(0)
  updatedAt DateTime @updatedAt

  @@id([vendorId, date])
  @@map("bill_sequences")
}

// ─── VOICE PARSE LOG (training corpus + observability) ─────────────
// Written async via BullMQ — never blocks /api/ai/parse-order response.
// 90-day TTL via scheduled cleanup. NEVER store customer PII here.

model VoiceParseLog {
  id          String   @id @default(cuid())
  vendorId    String
  vendor      Vendor   @relation(fields: [vendorId], references: [id], onDelete: Cascade)
  transcript  String                                          // Voice transcript only
  lang        String                                          // en-IN | hi-IN | te-IN | kn-IN | ta-IN
  sttSource   String                                          // 'webspeech' | 'sarvam'
  modelUsed   String                                          // 'claude-haiku-4-5' | 'claude-sonnet-4-5'
  escalated   Boolean  @default(false)
  itemCount   Int
  confidence  String                                          // 'high' | 'medium' | 'low'
  unmatched   String[] @default([])
  latencyMs   Int
  createdAt   DateTime @default(now())

  @@index([vendorId, createdAt])
  @@index([modelUsed, escalated])
  @@map("voice_parse_logs")
}

// ─── ENUMS ──────────────────────────────────────────────────────────

enum UserRole {
  USER            // Default — vendors and their staff
  ADMIN           // IntelliForge support / ops
  SUPER_ADMIN     // Platform owners
}

enum Plan {
  FREE            // 50 transactions/month, 1 staff
  STARTER         // ₹299/month — 500 txn, 3 staff, WhatsApp receipts
  PRO             // ₹799/month — unlimited, Razorpay links, analytics export
  ENTERPRISE      // Custom
}

enum StallType {
  GENERAL
  FOOD_BEVERAGE
  STREET_FOOD
  CARNIVAL
  SCHOOL_CANTEEN
  EVENT_POPUP
  KIRANA
  CLOTHING
  SERVICES
}

enum PaymentMethod {
  UPI
  CASH
  CARD
  RAZORPAY_LINK
}

enum PaymentStatus {
  PENDING
  PAID
  FAILED
  REFUNDED
}

enum OrderSource {
  VOICE           // Via AI voice (AwaazOS core)
  MANUAL          // Quick-add tap grid
  WHATSAPP        // Future: WhatsApp ordering
  API             // Future: 3rd party integrations
}

enum StaffRole {
  OWNER
  MANAGER
  CASHIER
}
```

---

## ⚙️ .cursorrules

```
# AwaazOS — Cursor Rules
# An IntelliForge AI Product | awaazos.in

## Identity
You are building AwaazOS: a multi-tenant AI voice-powered POS and billing SaaS
for Indian small vendors. Tagline: "Bol. Bill. Becho."

Stack: Next.js 14 App Router · TypeScript · Prisma · Neon (serverless Postgres) ·
Auth.js v5 · Tailwind CSS · shadcn/ui · Anthropic Claude API ·
Sarvam Saaras STT · Razorpay · Gupshup · BullMQ + Redis · Vercel Blob.

## India-First Conventions — STRICTLY FOLLOW
- ALL monetary values stored in PAISE (integer). Never Decimal for money.
  ₹20 = 2000 paise. ₹299 = 29900 paise.
- Display amounts with Intl.NumberFormat('en-IN', { style:'currency', currency:'INR' })
- Phone numbers: +91 prefix, 10-digit validation
- Dates: DD/MM/YYYY display format, IST (Asia/Kolkata) for all timestamps
- Bill numbers: AWZ-YYYYMMDD-NNNN (e.g. AWZ-20260502-0001), reset daily per vendor
- Tax: CGST + SGST (intra-state), IGST (inter-state), stored in paise

## Architecture Rules
- Every protected API route starts with Auth.js + RBAC:
    const { user, vendor } = await requireVendorRole('CASHIER')   // or 'OWNER' / 'MANAGER'
- Every DB query scoped to vendor.id — NEVER cross-tenant data leaks
- Reads:  prisma.x.findMany({ where: { vendorId: vendor.id, ... } })
- Writes: prisma.x.update/delete({ where: { id, vendorId: vendor.id } })
  (compound where guards against forged ids)
- Use prisma.$transaction([...]) for multi-table writes
- Monetary calculations: always integer arithmetic in paise, never floating point
- Background jobs (WhatsApp receipts, voice parse logs) via BullMQ — never block API response
- middleware.ts imports auth.config.ts ONLY (edge-safe). Prisma + Credentials live in auth.ts.

## Voice AI Rules (useVoiceOrder hook)
- STT routing by VendorSettings.voiceLang:
    en-IN, hi-IN          → Web Speech API (free, browser-native)
    te-IN, kn-IN, ta-IN   → Sarvam Saaras v2 STT (Web Speech is unreliable for these)
- Send transcript to /api/ai/parse-order with vendor's menu context
- PRIMARY parser: Claude Haiku 4.5 with strict JSON schema output
- FALLBACK to Claude Sonnet 4.5 ONLY when:
    (a) JSON.parse fails on Haiku output, OR
    (b) result.items is [] but transcript word-count > 3, OR
    (c) result.confidence === "low" AND result.unmatched.length > 0
- Use Anthropic prompt caching for the menu block (cache_control: ephemeral)
- Stream Haiku response into the cart UI for sub-second perceived latency
- Default qty = 1 if not specified in voice command
- Normalize Indic numerals: ek/do/teen/char/paanch (hi),
    okati/rendu/moodu/naalugu/aidu (te), ondu/eradu/mooru (kn),
    onnu/rendu/moonu (ta)
- Fallback: show QuickAddGrid when voice fails or browser unsupported
- Supported langs: en-IN, hi-IN, te-IN, kn-IN, ta-IN
- Log every (transcript, parsed_result, model_used, latency_ms) for 90 days
    — this becomes the training set for future fine-tuning on Indic models
- NEVER send customer PII (phone, name) to the LLM — menu + transcript only

## UPI Rules
- QR URL: https://api.qrserver.com/v1/create-qr-code/?size=256x256&data={upiLink}
- UPI deep link: upi://pay?pa={upiId}&pn={name}&am={rupees}&cu=INR&tn={billNumber}
  NOTE: amount in RUPEES (not paise) in UPI deep link
- Razorpay Payment Link for Pro plan (async payment confirmation via webhook)
- Always show UTR reference field for vendor to confirm manual UPI payments

## File & Code Conventions
- All server actions: /app/api/... route.ts with proper HTTP methods
- Client components: 'use client' at top
- Shared types: /types/index.ts
- Constants: /lib/constants.ts (PLANS, STALL_TYPES, etc.)
- Error handling: always return { error: string } with appropriate HTTP status
- Loading states: all async UI must have skeleton loaders
- Toast notifications: sonner (already in shadcn/ui)

## Multi-Tenancy Rules
- Vendor (Prisma model) = the tenant. Vendor.id IS the tenant id.
- User (Auth.js) ↔ Vendor is many-to-many via StaffMember (with StaffRole).
- A new sign-up creates User + Vendor + StaffMember(OWNER) in one prisma.$transaction
  inside POST /api/auth/register — never split across requests.
- VendorSettings auto-created in the same transaction as the Vendor.
- session.user.id resolves to one or more vendors via StaffMember.
  If a user belongs to >1 vendor, an active vendor is selected via:
    1. ?vendor=<slug> query param, else
    2. cookie `awz_vendor` (set on selection), else
    3. first vendor by createdAt (auto-set cookie).
- Plan limits enforced server-side on every transaction creation (see lib/rbac.ts).

## Component Rules
- POS screen is mobile-first — designed for 390px width (vendor's phone)
- All shadcn/ui components used as-is, only Tailwind for custom styles
- No inline styles — use Tailwind utility classes only
- Icons: lucide-react only
- Color theme stored in VendorSettings.theme, applied via CSS variables

## Testing & Quality
- zod schemas for all API request/response validation
- React Hook Form for all forms with zod resolver
- Optimistic UI updates on cart changes (no loading spinner on add/remove)
- Error boundaries on POS screen — vendor cannot be blocked mid-transaction
```

---

## 🔑 ENV VARIABLES (.env.local.example)

```bash
# ─── Database (Neon serverless Postgres) ──────────────────────────────
# DATABASE_URL  = pooled connection (host contains '-pooler') for app runtime
# DIRECT_URL    = direct connection (no '-pooler') for `prisma migrate` only
# Get both from the Neon console → Connection Details → Show password.
DATABASE_URL="postgresql://<user>:<password>@<endpoint>-pooler.<region>.aws.neon.tech/<db>?sslmode=require&channel_binding=require"
DIRECT_URL="postgresql://<user>:<password>@<endpoint>.<region>.aws.neon.tech/<db>?sslmode=require&channel_binding=require"

# ─── Auth.js v5 ───────────────────────────────────────────────────────
# Generate AUTH_SECRET with: openssl rand -base64 32
AUTH_SECRET=
AUTH_URL=http://localhost:3000          # required when NOT on Vercel (dev/Docker)
AUTH_TRUST_HOST=true                    # required behind proxies without AUTH_URL

# ─── Anthropic (Haiku 4.5 primary, Sonnet 4.5 fallback) ──────────────
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_PRIMARY_MODEL=claude-haiku-4-5
ANTHROPIC_FALLBACK_MODEL=claude-sonnet-4-5

# ─── Sarvam AI (STT for te-IN, kn-IN, ta-IN) ─────────────────────────
SARVAM_API_KEY=...
SARVAM_STT_MODEL=saaras:v2

# ─── Razorpay ─────────────────────────────────────────────────────────
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...

# ─── Gupshup (WhatsApp) ───────────────────────────────────────────────
GUPSHUP_API_KEY=...
GUPSHUP_APP_NAME=awaazos
GUPSHUP_SRC_NUMBER=917XXXXXXXXX

# ─── Redis (BullMQ) ───────────────────────────────────────────────────
REDIS_URL=redis://...

# ─── Vercel Blob (logos, PDF receipts) ────────────────────────────────
# Auto-injected on Vercel deploys; set manually only for local dev.
BLOB_READ_WRITE_TOKEN=

# ─── App ──────────────────────────────────────────────────────────────
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

> **Where the real Neon credentials live:** never in `.env.local.example` (committed)
> and never in git. Put the actual `DATABASE_URL` / `DIRECT_URL` in a gitignored
> `.env.local`. The connection string shared in chat must be **rotated in the Neon
> console** before going to production.

---

## 🚀 CURSOR PROMPT SEQUENCE

Run these prompts in Cursor **in order**. Each builds on the previous.

---

### PROMPT 1 — Project Scaffold

```
Create a new Next.js 14 App Router project called awaazos with TypeScript strict mode.

Install and configure:
- tailwindcss, shadcn/ui (init with default theme, slate base)
- @prisma/client, prisma
- next-auth@beta, @auth/prisma-adapter, bcryptjs, @types/bcryptjs
- @neondatabase/serverless    # for edge routes that need raw SQL
- @vercel/blob                # logos, PDF receipts
- @anthropic-ai/sdk
- razorpay
- bullmq, ioredis
- zustand
- react-hook-form, @hookform/resolvers, zod
- recharts
- sonner
- lucide-react
- libphonenumber-js           # +91 phone validation

Do NOT install: @clerk/nextjs, @supabase/supabase-js, svix.

Create the full directory structure as defined in the AwaazOS architecture
(including middleware.ts at the root, types/next-auth.d.ts inside src/types,
and the .cursor/rules/ folder).

Create .env.local.example with all required variables (placeholders only —
real Neon/Anthropic/Razorpay values go in gitignored .env.local).
Create .cursorrules with AwaazOS rules (or split into per-folder .mdc rules
under .cursor/rules/).
Initialize Prisma with the full schema (see PRISMA SCHEMA section).
Run prisma generate.
```

---

### PROMPT 2 — Prisma Schema + DB Setup

```
Implement the full AwaazOS Prisma schema with all 9 models:
Vendor, VendorSettings, MenuItem, Transaction, OrderItem,
Receipt, DailySummary, StaffMember, and all enums.

After schema is ready:
1. Create /lib/prisma.ts singleton client
2. Create /lib/currency.ts with:
   - paiseToRupees(paise: number): number
   - rupeesToPaise(rupees: number): number
   - formatINR(paise: number): string  // uses Intl.NumberFormat en-IN
3. Create /lib/upi.ts with:
   - buildUpiDeepLink(upiId, name, amountRupees, billRef): string
   - buildQrUrl(upiLink: string, size?: number): string
4. Create /lib/constants.ts with PLAN_LIMITS, STALL_TYPES, VOICE_LANGUAGES
5. Create /types/index.ts with all shared TypeScript types
```

---

### PROMPT 3 — Auth.js v5 + Vendor Onboarding

```
Set up Auth.js v5 multi-tenant auth for AwaazOS. Use the
auth-js-integration skill (Cursor skills) for the canonical edge-split
pattern. Key principle: ONE prisma.$transaction creates User +
Vendor + StaffMember(OWNER) + VendorSettings together — no webhooks.

1. /lib/auth.config.ts (edge-safe, imported by middleware.ts):
   - export const authConfig: NextAuthConfig
   - pages: { signIn: '/sign-in' }
   - providers: []   // empty — Credentials lives in auth.ts (Node only)
   - callbacks.authorized({ auth, request }):
       Block /(vendor)/* and /api/* (except /api/auth/*, /api/webhooks/*,
       /api/ai/transcribe is auth-required)
   - callbacks.jwt({ token, user }):
       On first sign-in, copy user.id and user.role onto token
   - callbacks.session({ session, token }):
       session.user.id = token.sub; session.user.role = token.role

2. /lib/auth.ts (Node):
   - import authConfig from './auth.config'
   - export const { handlers, auth, signIn, signOut } = NextAuth({
       ...authConfig,
       adapter: PrismaAdapter(prisma),
       session: { strategy: 'jwt' },
       providers: [Credentials({ ... verify with bcrypt against User.passwordHash })],
     })
   - export async function requireUser(): returns session.user or throws

3. /lib/rbac.ts:
   - export class AuthError extends Error { status: number }
   - export async function requirePlatformRole(role: 'ADMIN'|'SUPER_ADMIN')
   - export async function requireVendorRole(role: StaffRole, vendorIdOrSlug?: string):
       Promise<{ user, vendor, staff }>
       Resolves active vendor via:
         (a) explicit arg, else
         (b) ?vendor=<slug> on the request, else
         (c) cookie 'awz_vendor', else
         (d) first StaffMember by createdAt (sets cookie)
       Throws AuthError(403) if staff.role weaker than required.

4. /lib/password.ts:
   - hashPassword(plain: string) → bcrypt rounds=12
   - verifyPassword(plain, hash)

5. /lib/zod-auth.ts:
   - signInSchema  = { email, password }
   - signUpSchema  = { email, password (min 8), name, stallName, stallType, phone? }

6. /src/types/next-auth.d.ts (NOT at workspace root — that breaks TS resolution):
   - declare module 'next-auth' to add { id, role } to Session.user
   - declare module 'next-auth/jwt' to add { role } to JWT

7. /middleware.ts:
   - export { auth as middleware } = NextAuth(authConfig)
   - matcher: ['/((?!_next/static|_next/image|favicon.ico|api/webhooks).*)']

8. /app/api/auth/[...nextauth]/route.ts:
   - export const { GET, POST } = handlers

9. POST /app/api/auth/register/route.ts:
   - Body validated by signUpSchema
   - prisma.$transaction(async tx => {
       const user   = await tx.user.create({ data: { email, name, passwordHash, role: 'USER' } })
       const vendor = await tx.vendor.create({ data: { name: stallName, ownerName: name, stallType, slug } })
       await tx.vendorSettings.create({ data: { vendorId: vendor.id } })
       await tx.staffMember.create({ data: { vendorId: vendor.id, userId: user.id,
                                              name, phone, role: 'OWNER' } })
       return { userId: user.id, vendorId: vendor.id, vendorSlug: vendor.slug }
     })
   - Map Prisma P2002 (unique violation on email/slug) → HTTP 409
   - Set 'awz_vendor' cookie to vendor.slug

10. /app/(auth)/sign-in/page.tsx and /sign-up/page.tsx:
    - Custom shadcn/ui forms (NOT Auth.js default pages)
    - Wrap any useSearchParams() reader (?callbackUrl=) in <Suspense>
    - On submit: signIn('credentials', { email, password, redirect: false, callbackUrl })
    - On register success: immediately call signIn(...) so user lands on /onboarding

11. /app/(onboarding)/onboarding/page.tsx — 4-step wizard:
    Step 1: stall info already captured at sign-up → confirm + edit (city, state)
    Step 2: UPI ID + UPI display name (with live QR preview using lib/upi.ts)
    Step 3: Add first 3 menu items (name, price ₹, emoji, optional alias for voice)
    Step 4: WhatsApp number (+91, validated via libphonenumber-js) + voiceLang select
    On finish: PATCH /api/vendor → onboardingDone = true → redirect /pos
```

---

### PROMPT 4 — Menu Management CRUD

```
Build complete menu management for AwaazOS:

API routes:
- GET /api/menu — list all menu items for current vendor (sorted by sortOrder)
- POST /api/menu — create menu item (validate: name required, priceInPaise > 0)
- PATCH /api/menu/[id] — update menu item (vendor ownership check)
- DELETE /api/menu/[id] — soft delete via isAvailable=false

UI components:
- /app/(vendor)/menu/page.tsx — grid of MenuItemCards with drag-to-reorder
- MenuItemCard.tsx — shows emoji, name, ₹price, available toggle, edit/delete
- MenuItemForm.tsx — shadcn dialog with:
  - Name input + aliases input (comma-separated, for voice recognition)
  - Emoji picker (grid of 20 food emojis)
  - Price input (display in ₹, store as paise)
  - Category select + isPopular toggle
  - isAvailable toggle

All monetary inputs: accept ₹ input from user, convert to paise before storing.
Display ₹ formatted with formatINR() from /lib/currency.ts.
```

---

### PROMPT 5 — AI Voice Order Parser API (two-model strategy)

```
Build the core AI voice order parsing system for AwaazOS using a primary +
fallback LLM strategy. PRIMARY = Claude Haiku 4.5 (cheap, fast, schema-strict).
FALLBACK = Claude Sonnet 4.5 (only ~3% of calls, when Haiku is uncertain).

1. /lib/anthropic.ts:
   - Export two clients: anthropicHaiku, anthropicSonnet
   - Reads ANTHROPIC_PRIMARY_MODEL and ANTHROPIC_FALLBACK_MODEL from env
   - Helper: parseOrderWithClaude(client, menu, transcript) → typed result

2. /lib/sarvam.ts:
   - Sarvam Saaras v2 STT client (REST). Used for te-IN, kn-IN, ta-IN.
   - Function: transcribeAudio(blob, lang) → { transcript, confidence }

3. POST /api/ai/transcribe/route.ts (NEW — server STT for te/kn/ta):
   - Auth: const { vendor } = await requireVendorRole('CASHIER')
   - Input: multipart/form-data with field `audio` (Blob, .webm/.wav) + `lang`
   - Reject langs other than te-IN | kn-IN | ta-IN (caller must use Web Speech for en/hi)
   - Forward to Sarvam Saaras v2 via lib/sarvam.ts
   - 5-second hard timeout → respond { error, fallback: 'quickadd' }
   - Return: { transcript: string, durationMs: number }
   - DO NOT log audio bytes; only log durationMs and lang.

4. POST /api/ai/parse-order/route.ts:
   - Auth: const { vendor } = await requireVendorRole('CASHIER')
   - Input: { transcript: string, lang: string, sttSource: 'webspeech'|'sarvam' }
   - Fetch vendor's menu items from DB (id, name, aliases, priceInPaise,
     isAvailable=true only) — scoped to vendor.id
   - SYSTEM PROMPT (schema-locked, no prose, with caching directive):

     "You parse Indian-vendor voice orders into JSON for a billing POS.
      Output ONLY a single JSON object. No markdown. No prose.

      Schema:
      {
        \"items\": [
          { \"menuItemId\": string, \"name\": string,
            \"priceInPaise\": integer, \"qty\": integer }
        ],
        \"unmatched\": [string],
        \"confidence\": \"high\" | \"medium\" | \"low\"
      }

      Rules:
      - Match items by name OR aliases (case-insensitive)
      - Default qty = 1 when not specified
      - Normalize Indic numerals:
          hi: ek=1, do=2, teen=3, char=4, paanch=5
          te: okati=1, rendu=2, moodu=3, naalugu=4, aidu=5
          kn: ondu=1, eradu=2, mooru=3, naalku=4, aidu=5
          ta: onnu=1, rendu=2, moonu=3, naangu=4, anju=5
      - Put any phrase you could NOT confidently map into 'unmatched'
      - confidence = 'low' if unmatched.length > 0 OR transcript is ambiguous
      - Return items: [] if nothing matches

      Menu (JSON, treat as authoritative):
      {menuItemsJson}"

   - Send menu block with cache_control: { type: 'ephemeral' } so subsequent
     calls within 5 min hit the prompt cache (~90% input cost reduction)
   - Set max_tokens: 512, temperature: 0.1
   - PREFERRED: use Anthropic tool-use with a single tool `add_items` whose
     input_schema matches the JSON schema above. Tool use guarantees
     well-formed structured output and enables progressive UI updates
     (each tool_use delta yields a complete item).
   - Call Haiku FIRST. Validate result with zod schema.
   - ESCALATE to Sonnet 4.5 if any of:
       (a) zod validation fails or JSON.parse throws
       (b) items is [] AND transcript word-count > 3
       (c) confidence === 'low' AND unmatched.length > 0
   - Enqueue (do not await) a BullMQ job 'voice-parse-log' with:
       { vendorId, transcript, lang, sttSource, modelUsed, latencyMs,
         itemCount, confidence, unmatched, escalated }
     — written to VoiceParseLog by /workers/voiceLog.worker.ts. 90-day TTL.
   - Return: { items, unmatched, confidence, modelUsed }

5. Custom hook /hooks/useVoiceOrder.ts:
   - Read voiceLang from VendorSettings (en-IN default)
   - STT routing:
       en-IN, hi-IN          → Web Speech API (browser, free)
       te-IN, kn-IN, ta-IN   → MediaRecorder → POST to /api/ai/transcribe
                               (PLAN GATE: only available on STARTER+ — see PROMPT 9)
   - States: idle | listening | transcribing | parsing | success | error
   - On transcript ready: POST to /api/ai/parse-order with sttSource
   - Return: { startListening, stopListening, state, lastTranscript,
              parsedItems, unmatched, confidence }
   - If confidence === 'low': UI surfaces a 'Double-check this' banner
   - Fallback message + auto-show QuickAddGrid if STT unsupported

6. Test cases (Vitest fixtures, all must return correct items):
   - "do bhel aur ek nimbu pani"        (Hindi, code-mixed numerals)
   - "one small bhel and two lemonades" (English)
   - "rendu large bhel"                  (Telugu)
   - "moodu samosa, okati chai"          (Telugu, multi-item)
   - "ek vada pav"                       (Hindi single item)
   - "scooty chahiye"                    (off-menu → items:[], unmatched:["scooty"])
```

---

### PROMPT 6 — POS Screen (Core Feature)

```
Build the main POS screen at /app/(vendor)/pos/page.tsx.
This is mobile-first (390px), the vendor uses their phone as the billing device.

Layout (top to bottom):
1. Header: Stall name + today's revenue KPI + settings icon
2. VoiceOrderButton.tsx:
   - Large circular mic button (80px)
   - States: idle (orange), listening (red pulsing), processing (purple spinning)
   - Show AI status message below button
   - Show transcript in small italic text
3. QuickAddGrid.tsx:
   - 2-column grid of vendor's menu items (popular items first)
   - Each tile: emoji + name + ₹price, tap to add to cart
   - Only show isAvailable items
4. OrderCart.tsx (Zustand store):
   - List of current order items with qty +/- controls and ✕ remove
   - Running subtotal → tax (if enabled) → total in ₹
   - "Collect Payment" CTA button (orange, full width)
5. UpiQRModal.tsx (shadcn Sheet from bottom):
   - Amount in large ₹ display
   - UPI QR code image (256x256 from api.qrserver.com)
   - "Scan with GPay / PhonePe / Paytm"
   - UPI ID display
   - UTR reference input (vendor manually confirms)
   - "Mark as Paid ✅" button → creates Transaction, shows success
   - "Customer got receipt?" → opens ReceiptModal
6. ReceiptModal.tsx:
   - Customer phone input (+91)
   - "Send on WhatsApp" button → POST /api/receipts/send
   - "New Order 🆕" → clears cart, closes modals

Zustand cartStore.ts:
- addItem, removeItem, updateQty, clearCart, getTotal (paise)

After payment marked: POST /api/transactions to create Transaction + OrderItems.
```

---

### PROMPT 7 — Transaction API + Receipt System

```
Build the transaction and receipt system for AwaazOS:

1. POST /api/transactions/route.ts:
   - Auth: const { vendor } = await requireVendorRole('CASHIER')
   - Plan-gate: enforce monthly txn limit per vendor.plan
   - All steps INSIDE prisma.$transaction(async tx => { ... }):
     a) Atomically advance the per-day sequence:
          const seq = await tx.billSequence.upsert({
            where:  { vendorId_date: { vendorId: vendor.id, date: todayDate } },
            create: { vendorId: vendor.id, date: todayDate, lastSeq: 1 },
            update: { lastSeq: { increment: 1 } },
          })
        billNumber = `AWZ-${YYYYMMDD}-${String(seq.lastSeq).padStart(4,'0')}`
     b) Create Transaction with OrderItems
     c) Upsert DailySummary for today's date
     d) Create Receipt row (whatsappSent=false)
   - After commit (outside the tx): if customerPhone provided AND vendor.plan ≥ STARTER,
     enqueue BullMQ 'send-receipt' job
   - Return: { transaction, receiptNumber }

2. GET /api/transactions/route.ts:
   - Paginated list (20 per page) for current vendor
   - Filter by: date range, paymentStatus, paymentMethod, source
   - Return with orderItems and receipt info

3. POST /api/receipts/send/route.ts:
   - Validate vendor has WhatsApp configured (VendorSettings.whatsappNumber)
   - Check plan allows WhatsApp receipts (STARTER+)
   - Add to BullMQ queue: { transactionId, customerPhone }
   - Return { queued: true }

4. /workers/receipt.worker.ts (BullMQ):
   - Process receipt jobs
   - Format WhatsApp message with bill details in ₹
   - Send via Gupshup API
   - Update Receipt.whatsappSent = true + whatsappSentAt

5. /app/(vendor)/transactions/page.tsx:
   - Table with columns: Bill#, Date/Time, Items, Total ₹, Method, Status
   - Filter bar (date picker, status select)
   - Click row → drawer with full transaction detail
   - Export CSV button (Pro plan only)
```

---

### PROMPT 8 — Analytics Dashboard

```
Build the sales analytics dashboard for AwaazOS at /app/(vendor)/analytics/page.tsx:

API routes:
- GET /api/analytics/daily?days=30 — revenue per day (from DailySummary)
- GET /api/analytics/top-items?days=30 — top 10 items by revenue (from OrderItem)
- GET /api/analytics/summary — today, this week, this month KPIs

Dashboard components:
1. StatCard row (4 cards):
   - Today's Revenue (₹)
   - Today's Transactions (count)
   - Average Bill Value (₹)
   - Top Item Today (name)

2. RevenueChart.tsx:
   - Recharts AreaChart — last 30 days daily revenue
   - X-axis: DD MMM, Y-axis: ₹ formatted
   - Orange gradient fill, orange line

3. TopItemsChart.tsx:
   - Recharts HorizontalBarChart — top 10 items
   - Shows item name + total revenue + units sold

4. PaymentMethodPie.tsx:
   - Recharts PieChart — UPI vs Cash split
   
5. Date range picker: Today / This Week / This Month / Custom
   
All chart Y-axes: format paise → ₹ using formatINR().
All analytics scoped to current vendorId — no cross-tenant data.
```

---

### PROMPT 9 — Razorpay Subscription + Plan Gates

```
Implement Razorpay subscription billing for AwaazOS SaaS:

Plans (store in lib/constants.ts):
- FREE: ₹0, 50 txn/month, 1 staff, no WhatsApp
- STARTER: ₹299/month = 29900 paise, 500 txn/month, 3 staff, WhatsApp receipts
- PRO: ₹799/month = 79900 paise, unlimited txn, unlimited staff, Razorpay Links, CSV export

1. /app/(marketing)/pricing/page.tsx:
   - 3-column pricing table with feature comparison
   - "Start Free" / "Upgrade to Starter" / "Go Pro" CTAs
   - All prices in ₹ with Razorpay checkout integration

2. POST /api/razorpay/create-subscription/route.ts:
   - Create Razorpay subscription for selected plan
   - Return subscription ID for frontend checkout

3. POST /api/webhooks/razorpay/route.ts:
   - Verify Razorpay webhook signature
   - On subscription.activated: update Vendor.plan + planExpiresAt
   - On subscription.cancelled: downgrade to FREE

4. SubscriptionGate.tsx component:
   - Wrap Pro/Starter-only features
   - Show upgrade prompt if current plan insufficient
   - Check: vendor.plan >= requiredPlan

5. /app/(vendor)/settings/billing/page.tsx:
   - Current plan display
   - Usage this month (txn count vs limit)
   - Upgrade/cancel buttons
   - Invoice history from Razorpay

Gate these features behind plan:
- WhatsApp receipts: STARTER+
- Multiple staff: STARTER+
- Razorpay payment links: PRO
- CSV export: PRO
- Analytics beyond 7 days: STARTER+
- Sarvam STT (te-IN, kn-IN, ta-IN voice): STARTER+
    Rationale: Sarvam is paid per audio-minute. FREE-tier vendors using te/kn/ta
    must fall back to QuickAddGrid (typed entry). Web Speech (en-IN, hi-IN)
    remains free on all plans.

Implement plan-gate enforcement in /lib/rbac.ts:
  requirePlan(vendor, minPlan: Plan): asserts vendor.plan >= minPlan
And use it in:
  - /api/ai/transcribe (Sarvam)
  - /api/receipts/send (WhatsApp)
  - /api/transactions (monthly txn cap)
  - /api/upi/payment-link (Razorpay Links)
```

---

### PROMPT 10 — Landing Page + Deployment

```
Build the AwaazOS marketing landing page at /app/(marketing)/page.tsx:

Design: Mobile-first, saffron/orange (#FF6B00) primary, deep charcoal text.
Font: Baloo 2 (headings) + Nunito (body) via Google Fonts.

Sections:
1. Hero: 
   - "Bol. Bill. Becho." — large Hindi tagline
   - Subheading: "India's first AI voice-powered billing app for small vendors"
   - "Start Free — No Credit Card" CTA
   - Phone mockup showing POS screen with mic button
   - Trust badges: "IntelliForge AI Product" + "Bharat AI Mission Aligned"

2. How It Works (3 steps with icons):
   - 🎤 Bol — Speak the order in any Indian language
   - 🧾 Bill — AI creates the bill instantly
   - 📲 Becho — Customer pays via UPI QR

3. Features Grid (6 cards):
   Voice Orders, UPI QR Payment, WhatsApp Receipts,
   Sales Analytics, Multi-Language, Works Offline*

4. Pricing section (from PROMPT 9)

5. Social proof: "Trusted by vendors at 50+ events across Hyderabad"

6. Footer: IntelliForge AI branding + Bharat AI Mission badge

Deployment checklist (add to CURSOR_PLAYBOOK.md):
- Vercel: connect GitHub repo, add all env vars (DATABASE_URL, DIRECT_URL,
    AUTH_SECRET, ANTHROPIC_*, SARVAM_*, RAZORPAY_*, GUPSHUP_*, REDIS_URL,
    BLOB_READ_WRITE_TOKEN). AUTH_URL is auto-detected on Vercel.
- Vercel Blob: enable in project settings → BLOB_READ_WRITE_TOKEN auto-injected.
- Neon: create prod branch, copy pooled+direct URLs into Vercel env.
    Run `prisma migrate deploy` from local with DIRECT_URL set.
- Fly.io: deploy BullMQ workers (receipt + voiceLog) — single Dockerfile,
    one app, two process groups in fly.toml.
- Auth.js: rotate AUTH_SECRET for prod (`openssl rand -base64 32`).
- Razorpay: switch to live keys, configure webhook → /api/webhooks/razorpay.
- Domain: point awaazos.in to Vercel; add to Razorpay allowed origins;
    add to Auth.js trusted hosts (Vercel auto-handles this).
```

---

## 📋 CURSOR_PLAYBOOK.md

```markdown
# AwaazOS — Cursor Playbook

## Build Order
1. [ ] PROMPT 1 — Project Scaffold (Auth.js + Neon + Vercel Blob deps)
2. [ ] PROMPT 2 — Prisma Schema + DB Setup
3. [ ] PROMPT 3 — Auth.js v5 + Vendor Onboarding (single $transaction)
4. [ ] PROMPT 4 — Menu Management CRUD
5. [ ] PROMPT 5 — AI Voice Pipeline (Sarvam STT + Haiku/Sonnet two-tier)
6. [ ] PROMPT 6 — POS Screen (Core Feature) ⭐
7. [ ] PROMPT 7 — Transaction API + Receipt System (atomic BillSequence)
8. [ ] PROMPT 8 — Analytics Dashboard
9. [ ] PROMPT 9 — Razorpay Subscription + Plan Gates (incl. Sarvam STARTER+)
10. [ ] PROMPT 10 — Landing Page + Deployment

## Key Decisions Log
- Money: ALWAYS paise (integer). Never Decimal. Never float.
- Bill numbers: AWZ-YYYYMMDD-NNNN per vendor per day
    Generated via atomic upsert on BillSequence inside the same prisma.$transaction
    that creates the Transaction — eliminates count()-based race conditions.
- Database: Neon serverless Postgres (pooled URL for runtime, direct URL for migrations)
- Auth: Auth.js v5 (NextAuth) + Prisma adapter + bcrypt Credentials.
    Vendor (Prisma) is the tenant. User × Vendor m2m via StaffMember.
    Active vendor selection: ?vendor=<slug> → cookie → first by createdAt.
    Sign-up creates User+Vendor+VendorSettings+StaffMember(OWNER) in one $transaction.
- Storage: Vercel Blob (logos, PDF receipts) — no Supabase dependency.
- Voice STT (language-routed):
    en-IN, hi-IN          → Web Speech API (free, browser-native)
    te-IN, kn-IN, ta-IN   → Sarvam Saaras v2 (browser STT unreliable here)
- Voice NLU (two-tier):
    PRIMARY  → Claude Haiku 4.5  (cheap, fast, strict JSON schema)
    FALLBACK → Claude Sonnet 4.5 (only on parse failure / low confidence)
    Anthropic prompt caching on the menu block → ~90% input cost reduction
    Stream Haiku response into cart UI for sub-second perceived latency
- Why NOT Sonnet 4 as primary: 5–10× more expensive than needed for entity
    extraction; would consume >10% of PRO plan revenue per vendor at scale.
- Why NOT Gemini 2.5 Flash as primary: marginally cheaper but weaker JSON
    schema discipline in production tests; reconsider if Anthropic costs
    exceed budget at >10K active vendors.
- Why NOT a single India-native LLM (Sarvam-M, Krutrim) as primary today:
    weaker function-calling / JSON-mode reliability; revisit once we have
    90 days of (transcript, parse) logs to fine-tune on.
- QR: api.qrserver.com for FREE plan, Razorpay Payment Links for PRO
- WhatsApp: BullMQ queue → Gupshup API (never block API response)
- Voice telemetry: VoiceParseLog (transcript + parse, NO PII) written async via
    BullMQ 'voice-parse-log' worker. 90-day TTL. Future fine-tuning corpus.
- Plan gate on Sarvam (te/kn/ta voice): STARTER+ only — Sarvam is paid per
    audio-minute and would burn unit economics on FREE-tier abuse.
- Offline POS: deferred to v1.1 (Serwist + Dexie + replay queue). Marketing
    page asterisk on "Works Offline*" reflects this.
- GST: gstin (Vendor), hsnDefault (VendorSettings), hsnCode (MenuItem) are
    nullable day-1 to allow ₹20L+ vendors to upgrade later without migration.

## India Conventions Checklist
- [ ] All prices in paise in DB
- [ ] All display uses formatINR() from /lib/currency.ts
- [ ] Dates shown in DD/MM/YYYY
- [ ] Timestamps in IST (Asia/Kolkata)
- [ ] Phone numbers validated as +91 10-digit
- [ ] Bill numbers follow AWZ-YYYYMMDD-NNNN pattern

## Monetization
| Plan     | Price/mo | Txn Limit | Staff | WhatsApp | Razorpay Links |
|----------|----------|-----------|-------|----------|----------------|
| FREE     | ₹0       | 50        | 1     | ❌        | ❌              |
| STARTER  | ₹299     | 500       | 3     | ✅        | ❌              |
| PRO      | ₹799     | Unlimited | ∞     | ✅        | ✅              |

## TAM
- 63M+ unorganized retail vendors in India
- 2.5M+ street food vendors
- 500K+ school canteens
- AwaazOS TAM (India): ₹4,700 Cr+
```

---

## 🎯 POSITIONING

**For YC / Investor Pitch:**

> "AwaazOS is Shopify for India's 63 million unorganized vendors —
> but voice-first, UPI-native, and built for Bharat.
> A vendor says 'do bhel aur ek nimbu pani' — our AI bills it, generates a UPI QR,
> and sends a WhatsApp receipt. In under 10 seconds. In any Indian language.
> This is IntelliForge AI's Bharat Mission product."

**GitHub:** `github.com/gengirish/awaazos`
**Domain:** `awaazos.in`
**Product Page:** `awaazos.intelliforge.tech`
**Built by:** IntelliForge AI, Hyderabad

---
*Generated by IntelliForge AI | Cursor Kickoff Pack v2.0 — Auth.js + Neon edition*
