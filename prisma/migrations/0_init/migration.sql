-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('FREE', 'STARTER', 'PRO', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "StallType" AS ENUM ('GENERAL', 'FOOD_BEVERAGE', 'STREET_FOOD', 'CARNIVAL', 'SCHOOL_CANTEEN', 'EVENT_POPUP', 'KIRANA', 'CLOTHING', 'SERVICES', 'HOME_BAKERY', 'HOME_KITCHEN', 'CLOUD_KITCHEN', 'CAFE', 'SWEETS', 'CATERING', 'OTHER');

-- CreateEnum
CREATE TYPE "OfferEligibility" AS ENUM ('ALL', 'ITEMS', 'TAG');

-- CreateEnum
CREATE TYPE "OfferDiscountType" AS ENUM ('PERCENT', 'FIXED_AMOUNT', 'BUNDLE_PRICE');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('UPI', 'CASH', 'CARD', 'RAZORPAY_LINK');

-- CreateEnum
CREATE TYPE "ReceiptPaper" AS ENUM ('MM58', 'MM80', 'A4');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('VOICE', 'MANUAL', 'WHATSAPP', 'STOREFRONT', 'API');

-- CreateEnum
CREATE TYPE "DropStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED', 'FROZEN', 'FULFILLED');

-- CreateEnum
CREATE TYPE "FulfilmentMode" AS ENUM ('DELIVERY', 'PICKUP', 'BOTH');

-- CreateEnum
CREATE TYPE "FulfilmentType" AS ENUM ('DELIVERY', 'PICKUP');

-- CreateEnum
CREATE TYPE "FulfilmentStatus" AS ENUM ('PLACED', 'CONFIRMED', 'CANCELLED', 'DELIVERED');

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('OWNER', 'MANAGER', 'CASHIER');

-- CreateTable
CREATE TABLE "vendors" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "upiId" TEXT,
    "upiName" TEXT,
    "logoUrl" TEXT,
    "bannerUrl" TEXT,
    "plan" "Plan" NOT NULL DEFAULT 'FREE',
    "planExpiresAt" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "stallType" "StallType" NOT NULL DEFAULT 'GENERAL',
    "stallTypeOther" VARCHAR(40),
    "city" TEXT,
    "state" TEXT,
    "gstin" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "onboardingDone" BOOLEAN NOT NULL DEFAULT false,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "demoExternalRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_settings" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "sendWhatsappReceipt" BOOLEAN NOT NULL DEFAULT false,
    "autoPrintReceipt" BOOLEAN NOT NULL DEFAULT false,
    "taxEnabled" BOOLEAN NOT NULL DEFAULT false,
    "taxPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "discountEnabled" BOOLEAN NOT NULL DEFAULT false,
    "whatsappNumber" TEXT,
    "acceptWhatsappOrders" BOOLEAN NOT NULL DEFAULT false,
    "showWhatsappOnStore" BOOLEAN NOT NULL DEFAULT false,
    "instagramHandle" TEXT,
    "voiceLang" TEXT NOT NULL DEFAULT 'en-IN',
    "receiptFooter" TEXT,
    "receiptPaper" "ReceiptPaper" NOT NULL DEFAULT 'MM80',
    "theme" TEXT NOT NULL DEFAULT 'orange',
    "hsnDefault" TEXT,
    "publishStorefront" BOOLEAN NOT NULL DEFAULT false,
    "fssaiNumber" TEXT,
    "acceptPayOnDelivery" BOOLEAN NOT NULL DEFAULT true,
    "acceptMenuOrders" BOOLEAN NOT NULL DEFAULT false,
    "menuFulfilmentMode" "FulfilmentMode" NOT NULL DEFAULT 'PICKUP',
    "menuDeliveryFeePaise" INTEGER NOT NULL DEFAULT 0,
    "menuPickupNote" TEXT,
    "deliveryRiders" JSONB NOT NULL DEFAULT '[]',
    "razorpayKeyId" TEXT,
    "razorpayKeySecretEnc" TEXT,
    "razorpayWebhookSecretEnc" TEXT,
    "razorpaySubId" TEXT,
    "razorpaySubStatus" TEXT,
    "razorpaySubCancelAtEnd" BOOLEAN NOT NULL DEFAULT false,
    "billingInterval" TEXT,
    "razorpayCustomerId" TEXT,

    CONSTRAINT "vendor_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_events" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT,
    "razorpayEventId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "paymentId" TEXT,
    "amountPaise" INTEGER,
    "status" TEXT NOT NULL,
    "currentEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_items" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "emoji" TEXT NOT NULL DEFAULT '🍽️',
    "category" TEXT NOT NULL DEFAULT 'General',
    "priceInPaise" INTEGER NOT NULL,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "showOnline" BOOLEAN NOT NULL DEFAULT true,
    "isPopular" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "imageUrl" TEXT,
    "unit" TEXT,
    "hsnCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "menu_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offers" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "eligibility" "OfferEligibility" NOT NULL DEFAULT 'ALL',
    "eligibleItemIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "eligibleTag" TEXT,
    "minQty" INTEGER NOT NULL,
    "requiredTag" TEXT,
    "requiredTagQty" INTEGER NOT NULL DEFAULT 0,
    "discountType" "OfferDiscountType" NOT NULL DEFAULT 'PERCENT',
    "percentBps" INTEGER NOT NULL,
    "onMenuOrders" BOOLEAN NOT NULL DEFAULT true,
    "onDrops" BOOLEAN NOT NULL DEFAULT true,
    "onPos" BOOLEAN NOT NULL DEFAULT true,
    "dropIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drops" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "date" DATE NOT NULL,
    "fulfilmentMode" "FulfilmentMode" NOT NULL DEFAULT 'DELIVERY',
    "fulfilmentStartsAt" TIMESTAMP(3) NOT NULL,
    "fulfilmentEndsAt" TIMESTAMP(3) NOT NULL,
    "pickupNote" TEXT,
    "deliveryFeePaise" INTEGER NOT NULL DEFAULT 0,
    "opensAt" TIMESTAMP(3),
    "closesAt" TIMESTAMP(3) NOT NULL,
    "status" "DropStatus" NOT NULL DEFAULT 'DRAFT',
    "frozenAt" TIMESTAMP(3),
    "showEverydayMenu" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "drops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drop_items" (
    "id" TEXT NOT NULL,
    "dropId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "priceInPaise" INTEGER NOT NULL,
    "maxQty" INTEGER,
    "perOrderLimit" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "drop_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "savedAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_login_tokens" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "returnTo" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_login_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_sessions" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSuccessAt" TIMESTAMP(3),
    "failureCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "billNumber" TEXT NOT NULL,
    "subtotalPaise" INTEGER NOT NULL,
    "discountPaise" INTEGER NOT NULL DEFAULT 0,
    "offerId" TEXT,
    "offerName" TEXT,
    "taxPaise" INTEGER NOT NULL DEFAULT 0,
    "totalPaise" INTEGER NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'UPI',
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "upiRef" TEXT,
    "razorpayOrderId" TEXT,
    "razorpayPaymentId" TEXT,
    "paymentLinkUrl" TEXT,
    "customerPhone" TEXT,
    "customerName" TEXT,
    "voiceTranscript" TEXT,
    "source" "OrderSource" NOT NULL DEFAULT 'VOICE',
    "notes" TEXT,
    "paidAt" TIMESTAMP(3),
    "paymentClaimedAt" TIMESTAMP(3),
    "paymentRejectedAt" TIMESTAMP(3),
    "advancePaidPaise" INTEGER NOT NULL DEFAULT 0,
    "fulfilAt" TIMESTAMP(3),
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "dropId" TEXT,
    "fulfilmentStatus" "FulfilmentStatus",
    "fulfilmentType" "FulfilmentType",
    "deliveryAddress" TEXT,
    "deliveryFeePaise" INTEGER NOT NULL DEFAULT 0,
    "orderToken" TEXT,
    "outForDeliveryAt" TIMESTAMP(3),
    "riderName" TEXT,
    "riderToken" TEXT,
    "buyerReceivedAt" TIMESTAMP(3),
    "customerId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "clientRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "menuItemId" TEXT,
    "dropItemId" TEXT,
    "name" TEXT NOT NULL,
    "priceInPaise" INTEGER NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "totalPaise" INTEGER NOT NULL,
    "discountPaise" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "whatsappSent" BOOLEAN NOT NULL DEFAULT false,
    "whatsappSentAt" TIMESTAMP(3),
    "deliveredTo" TEXT,
    "pdfUrl" TEXT,
    "publicToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_summaries" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "totalRevenuePaise" INTEGER NOT NULL DEFAULT 0,
    "totalTransactions" INTEGER NOT NULL DEFAULT 0,
    "totalItemsSold" INTEGER NOT NULL DEFAULT 0,
    "cashRevenuePaise" INTEGER NOT NULL DEFAULT 0,
    "upiRevenuePaise" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_members" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "role" "StaffRole" NOT NULL DEFAULT 'CASHIER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "passwordHash" TEXT,
    "passwordChangedAt" TIMESTAMP(3),
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "requestIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "bill_sequences" (
    "vendorId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "lastSeq" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bill_sequences_pkey" PRIMARY KEY ("vendorId","date")
);

-- CreateTable
CREATE TABLE "voice_parse_logs" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "transcript" TEXT NOT NULL,
    "lang" TEXT NOT NULL,
    "sttSource" TEXT NOT NULL,
    "modelUsed" TEXT NOT NULL,
    "escalated" BOOLEAN NOT NULL DEFAULT false,
    "itemCount" INTEGER NOT NULL,
    "confidence" TEXT NOT NULL,
    "unmatched" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "latencyMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_parse_logs_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "admin_invites" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vendors_slug_key" ON "vendors"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "vendors_demoExternalRef_key" ON "vendors"("demoExternalRef");

-- CreateIndex
CREATE INDEX "vendors_slug_idx" ON "vendors"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_settings_vendorId_key" ON "vendor_settings"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_events_razorpayEventId_key" ON "subscription_events"("razorpayEventId");

-- CreateIndex
CREATE INDEX "subscription_events_vendorId_createdAt_idx" ON "subscription_events"("vendorId", "createdAt");

-- CreateIndex
CREATE INDEX "menu_items_vendorId_isAvailable_idx" ON "menu_items"("vendorId", "isAvailable");

-- CreateIndex
CREATE UNIQUE INDEX "menu_items_vendorId_slug_key" ON "menu_items"("vendorId", "slug");

-- CreateIndex
CREATE INDEX "offers_vendorId_isActive_idx" ON "offers"("vendorId", "isActive");

-- CreateIndex
CREATE INDEX "drops_vendorId_date_idx" ON "drops"("vendorId", "date");

-- CreateIndex
CREATE INDEX "drops_vendorId_status_idx" ON "drops"("vendorId", "status");

-- CreateIndex
CREATE INDEX "drop_items_dropId_idx" ON "drop_items"("dropId");

-- CreateIndex
CREATE UNIQUE INDEX "drop_items_dropId_menuItemId_key" ON "drop_items"("dropId", "menuItemId");

-- CreateIndex
CREATE UNIQUE INDEX "customers_email_key" ON "customers"("email");

-- CreateIndex
CREATE UNIQUE INDEX "customer_login_tokens_tokenHash_key" ON "customer_login_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "customer_login_tokens_customerId_idx" ON "customer_login_tokens"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_sessions_tokenHash_key" ON "customer_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "customer_sessions_customerId_idx" ON "customer_sessions"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_vendorId_idx" ON "push_subscriptions"("vendorId");

-- CreateIndex
CREATE INDEX "push_subscriptions_userId_idx" ON "push_subscriptions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_orderToken_key" ON "transactions"("orderToken");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_riderToken_key" ON "transactions"("riderToken");

-- CreateIndex
CREATE INDEX "transactions_vendorId_createdAt_idx" ON "transactions"("vendorId", "createdAt");

-- CreateIndex
CREATE INDEX "transactions_vendorId_paymentStatus_idx" ON "transactions"("vendorId", "paymentStatus");

-- CreateIndex
CREATE INDEX "transactions_billNumber_idx" ON "transactions"("billNumber");

-- CreateIndex
CREATE INDEX "transactions_dropId_idx" ON "transactions"("dropId");

-- CreateIndex
CREATE INDEX "transactions_customerId_idx" ON "transactions"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_vendorId_clientRef_key" ON "transactions"("vendorId", "clientRef");

-- CreateIndex
CREATE INDEX "order_items_transactionId_idx" ON "order_items"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_transactionId_key" ON "receipts"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_publicToken_key" ON "receipts"("publicToken");

-- CreateIndex
CREATE INDEX "receipts_vendorId_createdAt_idx" ON "receipts"("vendorId", "createdAt");

-- CreateIndex
CREATE INDEX "daily_summaries_vendorId_date_idx" ON "daily_summaries"("vendorId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_summaries_vendorId_date_key" ON "daily_summaries"("vendorId", "date");

-- CreateIndex
CREATE INDEX "staff_members_userId_idx" ON "staff_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "staff_members_vendorId_userId_key" ON "staff_members"("vendorId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_tokenHash_key" ON "password_reset_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_userId_idx" ON "password_reset_tokens"("userId");

-- CreateIndex
CREATE INDEX "password_reset_tokens_expiresAt_idx" ON "password_reset_tokens"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_providerAccountId_key" ON "accounts"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_sessionToken_key" ON "sessions"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_token_key" ON "verification_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_identifier_token_key" ON "verification_tokens"("identifier", "token");

-- CreateIndex
CREATE INDEX "voice_parse_logs_vendorId_createdAt_idx" ON "voice_parse_logs"("vendorId", "createdAt");

-- CreateIndex
CREATE INDEX "voice_parse_logs_modelUsed_escalated_idx" ON "voice_parse_logs"("modelUsed", "escalated");

-- CreateIndex
CREATE UNIQUE INDEX "demo_handovers_tokenHash_key" ON "demo_handovers"("tokenHash");

-- CreateIndex
CREATE INDEX "demo_handovers_vendorId_idx" ON "demo_handovers"("vendorId");

-- CreateIndex
CREATE INDEX "demo_audit_logs_action_createdAt_idx" ON "demo_audit_logs"("action", "createdAt");

-- CreateIndex
CREATE INDEX "demo_audit_logs_externalRef_idx" ON "demo_audit_logs"("externalRef");

-- CreateIndex
CREATE UNIQUE INDEX "admin_invites_tokenHash_key" ON "admin_invites"("tokenHash");

-- CreateIndex
CREATE INDEX "admin_invites_email_idx" ON "admin_invites"("email");

-- AddForeignKey
ALTER TABLE "vendor_settings" ADD CONSTRAINT "vendor_settings_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drops" ADD CONSTRAINT "drops_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drop_items" ADD CONSTRAINT "drop_items_dropId_fkey" FOREIGN KEY ("dropId") REFERENCES "drops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drop_items" ADD CONSTRAINT "drop_items_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_login_tokens" ADD CONSTRAINT "customer_login_tokens_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_sessions" ADD CONSTRAINT "customer_sessions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "offers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_dropId_fkey" FOREIGN KEY ("dropId") REFERENCES "drops"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "menu_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_dropItemId_fkey" FOREIGN KEY ("dropItemId") REFERENCES "drop_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_summaries" ADD CONSTRAINT "daily_summaries_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_members" ADD CONSTRAINT "staff_members_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_members" ADD CONSTRAINT "staff_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_sequences" ADD CONSTRAINT "bill_sequences_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_parse_logs" ADD CONSTRAINT "voice_parse_logs_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demo_handovers" ADD CONSTRAINT "demo_handovers_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

