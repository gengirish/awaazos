# Internal demo-store API

Lets the founder-outreach workflow build a realistic demo store for a prospect in
one call, and later hand it over. Code: `lib/demo-store.ts` (server),
`lib/demo-store-schema.ts` (validation), `app/api/internal/demo-stores/**`,
`app/api/demo-claim`, `app/(auth)/claim/[token]`.

## Rules

- **Auth:** header `x-internal-api-key: $INTERNAL_API_KEY` (server env, ≥ 32
  chars, never `NEXT_PUBLIC_`). Unset key, missing or wrong header → `401`
  before anything is read. Nothing in the PWA calls these routes.
- **Owner:** every demo store is owned (StaffMember OWNER) by one internal user,
  `DEMO_OWNER_EMAIL`, created on first use with no password. Sign in as it
  after a password reset from `/forgot-password`. The prospect owns nothing
  until they claim.
- **Never sends anything:** no WhatsApp, SMS, email or Web Push from any of
  these routes. Handover returns a link; you send it yourself.
- **UPI** is always `demo@upi`. A body with a UPI id, bank, IFSC, card,
  Razorpay or other credential key (any depth), or a `name@bank`-looking value
  anywhere, is refused with `400 { error: "payment_details_not_allowed", field }`.
- **Sample customer phones** must match `9199999xxxxx` (optional `+`). Note:
  `99999xxxxx` numbers are not formally reserved in India. The pattern is a policy that
  keeps scraped real numbers out, not proof that a number is unallocated.
- **Money** is integer paise; prices 1 … 1,00,00,000 paise (₹1,00,000).
- **Rate limit:** 20 creates per key per rolling 24 h (counted from the audit
  log, so it fails closed). Idempotent repeats don't count.
- **Audit:** `demo_audit_logs` gets `create`, `delete`, `handover` and `claim`
  rows with the external ref, vendor id, actor (a hash prefix of the key) and
  time. No emails or phones.
- **Exclusions:** demo stores and sample orders are not in `/admin/metrics`,
  never credit `DailySummary`, are not billable (`billableTxnWhere`), cannot
  subscribe (`409 demo_store_not_billable`), have no trial (never locked), and
  `/s/<slug>` is `noindex` with a "demo store" note. The name shows as
  "<name> (DEMO)" in the store header and the app shell. There are no public
  store listings to exclude them from.
- **UPI QR** on the store and order pages carries a "SAMPLE" badge while the
  store is a demo (`UpiQrImage` `sample`). The badge is small on purpose so
  the code still scans.
- **Display phone** is saved as the store's WhatsApp number with both public
  opt-ins off, so it is not shown until the owner turns it on.

## Field mapping

| Request | Stored as |
| --- | --- |
| `profile.name` | `Vendor.name` (stored clean; " (DEMO)" is added on display) |
| `profile.category` | `Vendor.stallType`, shown as the store-type chip: `home_bakery` → HOME_BAKERY ("Home bakery"), likewise `home_kitchen`, `cloud_kitchen`, `cafe`, `sweets`, `catering`; `street_food`; `general` |
| `profile.area` | `Vendor.city` |
| `profile.instagram` | `VendorSettings.instagramHandle` (normalised; invalid → none) |
| `profile.display_phone` | `VendorSettings.whatsappNumber`, not public |
| `profile.languages` | `VendorSettings.voiceLang` = first of en/hi offered, else en (te/kn/ta are dormant) |
| `profile.fulfilment` | `VendorSettings.menuFulfilmentMode`: `pickup` (default) / `delivery` / `both`. Sample orders are delivery orders (no address) only for `delivery` |
| `profile.delivery_fee_paise` | `VendorSettings.menuDeliveryFeePaise` (0 … 100000, default 0) |
| `items[].name` | `MenuItem.name`; the emoji is suggested from it (`suggestEmoji`: cake → 🎂, cupcake → 🧁, else 🍽️) |
| `items[].unit` | `MenuItem.unit`, shown as "₹1,200 / kg" |
| `sample_orders[]` | STOREFRONT `Transaction` with `isSample`, pickup, back-dated 47 min apart |
| `…event_date` | `Transaction.fulfilAt` |
| `…advance_paid_paise` | `Transaction.advancePaidPaise`, order stays PENDING; equal to the total → PAID |
| `…status` | `placed` / `confirmed` / `delivered` (→ paid) / `cancelled` |

An order with no advance is pay-on-delivery (CASH), so it does not show as an
expired UPI hold on the board.

## Handover

`POST …/handover` stores a SHA-256 of a 192-bit token, valid 7 days, and voids
earlier unused links for that store. It creates no account. The prospect opens
`/claim/<token>`, enters a name and password and chooses to hide or delete the
sample orders. In one transaction: the token is burned, their `User` is
created, they become OWNER, the demo account's membership and push devices are
removed, `isDemo` → false, `upiId` → null (they add their own), the 30-day
trial starts, and sample orders are archived (`archivedAt`, hidden from the
board, transactions and CSV) or deleted. If the email already has an account
the claim is refused (`409 email_in_use`) and the link stays usable; send a new
link to another email.

## OpenAPI

```yaml
openapi: 3.1.0
info: { title: AwaazOS internal demo stores, version: 1.0.0 }
servers: [{ url: https://<app-host> }]
components:
  securitySchemes:
    internalKey: { type: apiKey, in: header, name: x-internal-api-key }
  schemas:
    Error:
      type: object
      required: [error]
      properties:
        error: { type: string, examples: [rate_limited, not_found, not_a_demo_store, payment_details_not_allowed] }
        field: { type: string, description: Path of the refused payment field }
        issues: { type: array, items: { type: object }, description: Zod issues }
    CreateDemoStore:
      type: object
      additionalProperties: false
      required: [external_ref, profile, items]
      properties:
        external_ref: { type: string, pattern: "^[a-z0-9][a-z0-9-]{2,79}$" }
        profile:
          type: object
          additionalProperties: false
          required: [name]
          properties:
            name: { type: string, maxLength: 113 }
            category:
              type: string
              enum: [home_bakery, home_kitchen, cloud_kitchen, cafe, sweets, catering, street_food, general]
              default: general
            area: { type: string, maxLength: 120 }
            instagram: { type: string, maxLength: 120 }
            display_phone: { type: string, pattern: "^\\+?(91)?[6-9]\\d{9}$" }
            languages:
              type: array
              minItems: 1
              items: { type: string, enum: [en, hi, te, kn, ta] }
              default: [en]
            fulfilment: { type: string, enum: [pickup, delivery, both], default: pickup }
            delivery_fee_paise: { type: integer, minimum: 0, maximum: 100000, default: 0 }
        items:
          type: array
          minItems: 1
          maxItems: 100
          items:
            type: object
            additionalProperties: false
            required: [name, price_paise]
            properties:
              name: { type: string, maxLength: 80, description: Unique, case-insensitive }
              unit: { type: string, pattern: "^[a-zA-Z][a-zA-Z0-9 .]{0,15}$" }
              price_paise: { type: integer, minimum: 1, maximum: 10000000 }
              category: { type: string, maxLength: 40 }
        sample_orders:
          type: array
          maxItems: 50
          default: []
          items:
            type: object
            additionalProperties: false
            required: [customer_name, customer_phone, lines]
            properties:
              customer_name: { type: string, maxLength: 60 }
              customer_phone: { type: string, pattern: "^\\+?9199999\\d{5}$" }
              lines:
                type: array
                minItems: 1
                maxItems: 20
                items:
                  type: object
                  additionalProperties: false
                  required: [item, qty]
                  properties:
                    item: { type: string, description: Name of one of `items` }
                    qty: { type: integer, minimum: 1, maximum: 99 }
              event_date: { type: string, format: date-time, description: With offset }
              advance_paid_paise: { type: integer, minimum: 0, default: 0, description: "≤ order total" }
              status: { type: string, enum: [placed, confirmed, delivered, cancelled], default: placed }
    DemoStoreCreated:
      type: object
      required: [store_id, slug, public_url, owner_login_hint, created]
      properties:
        store_id: { type: string }
        slug: { type: string, examples: [prankie-s-bakery-001x] }
        public_url: { type: string, format: uri }
        owner_login_hint: { type: "null" }
        created: { type: boolean }
security: [{ internalKey: [] }]
paths:
  /api/internal/demo-stores:
    post:
      summary: Create a demo store (idempotent on external_ref)
      requestBody:
        required: true
        content: { application/json: { schema: { $ref: "#/components/schemas/CreateDemoStore" } } }
      responses:
        "201": { description: Created, content: { application/json: { schema: { $ref: "#/components/schemas/DemoStoreCreated" } } } }
        "200": { description: Already existed (created=false), content: { application/json: { schema: { $ref: "#/components/schemas/DemoStoreCreated" } } } }
        "400": { description: Validation failed or payment details present, content: { application/json: { schema: { $ref: "#/components/schemas/Error" } } } }
        "401": { description: Missing or wrong key }
        "429": { description: More than 20 creates in 24 h for this key }
        "503": { description: DEMO_OWNER_EMAIL not configured }
  /api/internal/demo-stores/{external_ref}:
    parameters: [{ name: external_ref, in: path, required: true, schema: { type: string } }]
    get:
      summary: Store summary and public URL
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    type: object
                    properties:
                      store_id: { type: string }
                      external_ref: { type: string }
                      slug: { type: string }
                      name: { type: string }
                      public_url: { type: string, format: uri }
                      is_demo: { type: boolean, description: false once claimed }
                      created_at: { type: string, format: date-time }
                      item_count: { type: integer }
                      sample_order_count: { type: integer }
                      pending_handover:
                        oneOf:
                          - { type: "null" }
                          - { type: object, properties: { expires_at: { type: string, format: date-time } } }
        "401": { description: Missing or wrong key }
        "404": { description: Unknown external_ref }
    delete:
      summary: Delete a demo store with its items, orders, receipts and payments
      responses:
        "200": { description: Deleted, content: { application/json: { schema: { type: object, properties: { success: { const: true } } } } } }
        "401": { description: Missing or wrong key }
        "404": { description: Unknown external_ref }
        "409": { description: Store has been claimed (is_demo=false); not deleted }
  /api/internal/demo-stores/{external_ref}/handover:
    parameters: [{ name: external_ref, in: path, required: true, schema: { type: string } }]
    post:
      summary: Create a one-time claim link (7 days). Sends nothing, creates no account.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              additionalProperties: false
              required: [owner_email]
              properties: { owner_email: { type: string, format: email } }
      responses:
        "201":
          description: Invite created; earlier unused links for this store are void
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    type: object
                    properties:
                      claim_url: { type: string, format: uri, examples: ["https://<app-host>/claim/<token>"] }
                      expires_at: { type: string, format: date-time }
        "400": { description: Invalid email }
        "401": { description: Missing or wrong key }
        "404": { description: Unknown external_ref }
        "409": { description: Already claimed }
```

## Sample: Prankie's Bakery with the full menu and 8 orders

```bash
curl -sS -X POST "$APP_URL/api/internal/demo-stores" \
  -H "content-type: application/json" \
  -H "x-internal-api-key: $INTERNAL_API_KEY" \
  --data-binary @- <<'JSON'
{
  "external_ref": "prankies-bakery-kondapur",
  "profile": {
    "name": "Prankie's Bakery",
    "category": "home_bakery",
    "area": "Kondapur, Hyderabad",
    "instagram": "@prankiesbakery",
    "display_phone": "+917396637770",
    "languages": ["en", "hi", "te"]
  },
  "items": [
    { "name": "Chocolate Truffle Cake", "unit": "kg", "price_paise": 120000, "category": "Cakes" },
    { "name": "Red Velvet Cake", "unit": "kg", "price_paise": 140000, "category": "Cakes" },
    { "name": "Black Forest Cake", "unit": "kg", "price_paise": 110000, "category": "Cakes" },
    { "name": "Pineapple Cake", "unit": "kg", "price_paise": 90000, "category": "Cakes" },
    { "name": "Blueberry Cheesecake", "unit": "kg", "price_paise": 180000, "category": "Cakes" },
    { "name": "Custom Theme Cake", "unit": "kg", "price_paise": 180000, "category": "Cakes" },
    { "name": "Bento Cake", "unit": "piece", "price_paise": 55000, "category": "Small cakes" },
    { "name": "Jar Cake", "unit": "piece", "price_paise": 18000, "category": "Small cakes" },
    { "name": "Cupcakes", "unit": "box of 6", "price_paise": 42000, "category": "Small cakes" },
    { "name": "Fudge Brownies", "unit": "box of 6", "price_paise": 48000, "category": "Bakes" },
    { "name": "Choco Chip Cookies", "unit": "box of 12", "price_paise": 36000, "category": "Bakes" },
    { "name": "Banana Walnut Tea Cake", "unit": "piece", "price_paise": 32000, "category": "Bakes" }
  ],
  "sample_orders": [
    { "customer_name": "Ananya", "customer_phone": "919999900001",
      "lines": [{ "item": "Chocolate Truffle Cake", "qty": 2 }],
      "event_date": "2026-10-18T18:00:00+05:30", "advance_paid_paise": 100000, "status": "confirmed" },
    { "customer_name": "Rohit", "customer_phone": "919999900002",
      "lines": [{ "item": "Bento Cake", "qty": 1 }, { "item": "Cupcakes", "qty": 1 }],
      "event_date": "2026-10-17T16:00:00+05:30", "advance_paid_paise": 97000, "status": "confirmed" },
    { "customer_name": "Meera", "customer_phone": "919999900003",
      "lines": [{ "item": "Custom Theme Cake", "qty": 3 }],
      "event_date": "2026-10-24T19:00:00+05:30", "advance_paid_paise": 200000, "status": "confirmed" },
    { "customer_name": "Kabir", "customer_phone": "919999900004",
      "lines": [{ "item": "Fudge Brownies", "qty": 2 }, { "item": "Choco Chip Cookies", "qty": 1 }],
      "status": "placed" },
    { "customer_name": "Sana", "customer_phone": "919999900005",
      "lines": [{ "item": "Red Velvet Cake", "qty": 1 }],
      "event_date": "2026-10-20T20:00:00+05:30", "status": "placed" },
    { "customer_name": "Arjun", "customer_phone": "919999900006",
      "lines": [{ "item": "Blueberry Cheesecake", "qty": 1 }, { "item": "Jar Cake", "qty": 4 }],
      "event_date": "2026-10-13T17:00:00+05:30", "advance_paid_paise": 252000, "status": "delivered" },
    { "customer_name": "Divya", "customer_phone": "919999900007",
      "lines": [{ "item": "Banana Walnut Tea Cake", "qty": 2 }],
      "advance_paid_paise": 64000, "status": "confirmed" },
    { "customer_name": "Farah", "customer_phone": "919999900008",
      "lines": [{ "item": "Pineapple Cake", "qty": 1 }],
      "event_date": "2026-10-16T18:30:00+05:30", "status": "cancelled" }
  ]
}
JSON
```

Then:

```bash
curl -sS "$APP_URL/api/internal/demo-stores/prankies-bakery-kondapur" -H "x-internal-api-key: $INTERNAL_API_KEY"
curl -sS -X POST "$APP_URL/api/internal/demo-stores/prankies-bakery-kondapur/handover" \
  -H "content-type: application/json" -H "x-internal-api-key: $INTERNAL_API_KEY" \
  -d '{"owner_email":"owner@example.com"}'
curl -sS -X DELETE "$APP_URL/api/internal/demo-stores/prankies-bakery-kondapur" -H "x-internal-api-key: $INTERNAL_API_KEY"
```

## Schema change (run before merging)

No migration files in this repo: `npx prisma db push` against Neon (direct URL),
or this SQL (`prisma migrate diff` output, main → this branch):

```sql
-- AlterTable
ALTER TABLE "vendors" ADD COLUMN     "demoExternalRef" TEXT,
ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "menu_items" ADD COLUMN     "unit" TEXT;

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "advancePaidPaise" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "fulfilAt" TIMESTAMP(3),
ADD COLUMN     "isSample" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "demo_handovers" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "demo_handovers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "demo_audit_logs" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "externalRef" TEXT NOT NULL,
    "vendorId" TEXT,
    "actor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "demo_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "demo_handovers_tokenHash_key" ON "demo_handovers"("tokenHash");

-- CreateIndex
CREATE INDEX "demo_handovers_vendorId_idx" ON "demo_handovers"("vendorId");

-- CreateIndex
CREATE INDEX "demo_audit_logs_action_createdAt_idx" ON "demo_audit_logs"("action", "createdAt");

-- CreateIndex
CREATE INDEX "demo_audit_logs_externalRef_idx" ON "demo_audit_logs"("externalRef");

-- CreateIndex
CREATE UNIQUE INDEX "vendors_demoExternalRef_key" ON "vendors"("demoExternalRef");

-- AddForeignKey
ALTER TABLE "demo_handovers" ADD CONSTRAINT "demo_handovers_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

## Schema change: store types (run before merging)

`npx prisma db push`, or:

```sql
ALTER TYPE "StallType" ADD VALUE IF NOT EXISTS 'HOME_BAKERY';
ALTER TYPE "StallType" ADD VALUE IF NOT EXISTS 'HOME_KITCHEN';
ALTER TYPE "StallType" ADD VALUE IF NOT EXISTS 'CLOUD_KITCHEN';
ALTER TYPE "StallType" ADD VALUE IF NOT EXISTS 'CAFE';
ALTER TYPE "StallType" ADD VALUE IF NOT EXISTS 'SWEETS';
ALTER TYPE "StallType" ADD VALUE IF NOT EXISTS 'CATERING';
```

Existing vendors keep their type. Sign-up and onboarding offer the new ones.
