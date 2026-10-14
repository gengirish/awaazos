/**
 * Internal demo stores for founder outreach (docs/INTERNAL_DEMO_STORES.md).
 * Request validation lives in lib/demo-store-schema.ts.
 *
 * A demo store is an ordinary Vendor with `isDemo = true`, owned through a
 * StaffMember(OWNER) row by one internal account (DEMO_OWNER_EMAIL), never by
 * the prospect. Rules:
 *
 * - Created in ONE transaction: vendor, settings, owner membership, items,
 *   sample orders (+ order items and receipts) and the audit row.
 * - `demoExternalRef` is the idempotency key: a repeat create returns the
 *   existing store, and a racing duplicate resolves to the winner on P2002.
 * - Nothing is sent: no WhatsApp, SMS, email or Web Push. Sample orders are
 *   written directly, not through placeMenuOrder (which pushes to devices).
 * - Sample orders carry `isSample` and never credit DailySummary.
 * - UPI is always DEMO_UPI_ID. The prospect's phone is kept as the WhatsApp
 *   number with both public opt-ins off, so it is not shown until they claim.
 * - Handover stores only a SHA-256 of the claim token; claiming creates the
 *   prospect's User with their own password, moves ownership, flips `isDemo`,
 *   starts the trial and archives (or deletes) the sample orders.
 * - Every create, delete, handover and claim writes a DemoAuditLog row (no PII).
 *   "create" rows double as the 20-per-day rate limit, so it fails closed.
 */
import { createHash, randomBytes } from "node:crypto";

import { Prisma } from "@prisma/client";

import { TRIAL_DAYS } from "@/lib/constants";
import {
  DEMO_CATEGORIES,
  DEMO_CLAIM_TTL_DAYS,
  DEMO_CREATES_PER_DAY,
  DEMO_UPI_ID,
  demoVoiceLang,
  itemKey,
  type DemoSampleOrderInput,
  type DemoStoreCreateInput,
} from "@/lib/demo-store-schema";
import { computeOrderTotals, generateOrderToken, nextBillNumber } from "@/lib/drops";
import { normaliseInstagramHandle } from "@/lib/instagram";
import { loadMenuCreateContext, prepareMenuItemCreate } from "@/lib/menu-create";
import { hashPassword } from "@/lib/password";
import { normaliseIndianMobile } from "@/lib/phone";
import { prisma } from "@/lib/prisma";
import { generateReceiptToken } from "@/lib/receipt-data";
import { appBaseUrl } from "@/lib/storefront-razorpay";
import { newVendorSlug } from "@/lib/store-slug";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Sample orders are back-dated this far apart, newest first, so the board looks lived in. */
const SAMPLE_ORDER_SPACING_MS = 47 * 60 * 1000;

export class DemoStoreError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
  }
}

export type DemoStoreSummary = {
  store_id: string;
  slug: string;
  public_url: string;
  owner_login_hint: null;
  created: boolean;
};

export function publicStoreUrl(slug: string): string {
  return `${appBaseUrl()}/s/${slug}`;
}

export function claimUrl(token: string): string {
  return `${appBaseUrl()}/claim/${token}`;
}

export function hashClaimToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function summary(v: { id: string; slug: string }, created: boolean): DemoStoreSummary {
  return { store_id: v.id, slug: v.slug, public_url: publicStoreUrl(v.slug), owner_login_hint: null, created };
}

function isUniqueViolation(err: unknown, field: string): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return false;
  const target = err.meta?.target;
  return (Array.isArray(target) ? target.join(" ") : String(target ?? "")).includes(field);
}

/** The internal account that owns every demo store. Created on first use, with no password. */
async function demoOwnerId(tx: Prisma.TransactionClient): Promise<string> {
  const email = (process.env.DEMO_OWNER_EMAIL ?? "").trim().toLowerCase();
  if (!email) throw new DemoStoreError(503, "demo_owner_not_configured");
  const user = await tx.user.upsert({
    where: { email },
    create: { email, name: "IntelliForge Demo", role: "USER" },
    update: {},
    select: { id: true },
  });
  return user.id;
}

// ─── Create ─────────────────────────────────────────────────────────

export async function createDemoStore(
  input: DemoStoreCreateInput,
  actor: string,
  now: Date = new Date(),
): Promise<DemoStoreSummary> {
  const existing = await prisma.vendor.findUnique({
    where: { demoExternalRef: input.external_ref },
    select: { id: true, slug: true },
  });
  if (existing) return summary(existing, false);

  const recent = await prisma.demoAuditLog.count({
    where: { action: "create", actor, createdAt: { gt: new Date(now.getTime() - DAY_MS) } },
  });
  if (recent >= DEMO_CREATES_PER_DAY) throw new DemoStoreError(429, "rate_limited");

  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const vendor = await prisma.$transaction((tx) => writeDemoStore(tx, input, actor, now), { timeout: 20_000 });
      return summary(vendor, true);
    } catch (err) {
      if (isUniqueViolation(err, "demoExternalRef")) {
        const winner = await prisma.vendor.findUnique({
          where: { demoExternalRef: input.external_ref },
          select: { id: true, slug: true },
        });
        if (winner) return summary(winner, false);
      }
      if (isUniqueViolation(err, "slug")) continue;
      throw err;
    }
  }
  throw new DemoStoreError(409, "slug_unavailable");
}

async function writeDemoStore(
  tx: Prisma.TransactionClient,
  input: DemoStoreCreateInput,
  actor: string,
  now: Date,
): Promise<{ id: string; slug: string }> {
  const { profile } = input;
  const ownerId = await demoOwnerId(tx);
  const instagram = normaliseInstagramHandle(profile.instagram) || null;
  const displayPhone = profile.display_phone ? normaliseIndianMobile(profile.display_phone) : null;

  const vendor = await tx.vendor.create({
    data: {
      slug: newVendorSlug(profile.name),
      name: profile.name,
      ownerName: "IntelliForge demo",
      upiId: DEMO_UPI_ID,
      upiName: profile.name,
      stallType: DEMO_CATEGORIES[profile.category],
      city: profile.area ?? null,
      onboardingDone: true,
      // No trial: billingAccess() treats trialEndsAt = null as "free", never
      // locked. The trial starts when the prospect claims the store.
      trialEndsAt: null,
      isDemo: true,
      demoExternalRef: input.external_ref,
      settings: {
        create: {
          publishStorefront: true,
          acceptMenuOrders: true,
          acceptPayOnDelivery: true,
          instagramHandle: instagram,
          whatsappNumber: displayPhone,
          acceptWhatsappOrders: false,
          showWhatsappOnStore: false,
          voiceLang: demoVoiceLang(profile.languages),
        },
      },
      staff: { create: { userId: ownerId, name: "IntelliForge demo", role: "OWNER" } },
    },
    select: { id: true, slug: true },
  });

  const ctx = await loadMenuCreateContext(tx, vendor.id);
  const menu = new Map<string, { id: string; name: string; priceInPaise: number }>();
  for (const item of input.items) {
    const data = prepareMenuItemCreate(ctx, vendor.id, {
      name: item.name,
      priceInPaise: item.price_paise,
      aliases: [],
      tags: [],
      emoji: "🍽️",
      category: item.category ?? "General",
      hsnCode: null,
      isPopular: false,
      isAvailable: true,
      showOnline: true,
    });
    const row = await tx.menuItem.create({
      data: { ...data, unit: item.unit ?? null },
      select: { id: true, name: true, priceInPaise: true },
    });
    menu.set(itemKey(item.name), row);
  }

  // Oldest first, so bill numbers rise with createdAt like real orders.
  const orders = input.sample_orders;
  for (let i = 0; i < orders.length; i++) {
    const createdAt = new Date(now.getTime() - (orders.length - i) * SAMPLE_ORDER_SPACING_MS);
    await writeSampleOrder(tx, vendor.id, orders[i]!, menu, createdAt);
  }

  await tx.demoAuditLog.create({
    data: { action: "create", externalRef: input.external_ref, vendorId: vendor.id, actor },
  });
  return vendor;
}

/** Order fields a sample order's status and advance map to. Pure; exported for tests. */
export function samplePaymentFields(
  order: Pick<DemoSampleOrderInput, "status" | "advance_paid_paise">,
  totalPaise: number,
  createdAt: Date,
) {
  // Delivered means the balance was collected at handover, as the board's
  // "Delivered · ₹X collected" tap records it.
  const fullyPaid = order.advance_paid_paise >= totalPaise || order.status === "delivered";
  const cancelled = order.status === "cancelled";
  return {
    // An unpaid order without an advance is pay-on-delivery, so the board
    // does not show it as an expired UPI hold.
    paymentMethod: order.advance_paid_paise > 0 ? ("UPI" as const) : ("CASH" as const),
    paymentStatus: fullyPaid ? (cancelled ? ("REFUNDED" as const) : ("PAID" as const)) : ("PENDING" as const),
    paidAt: fullyPaid ? createdAt : null,
    advancePaidPaise: fullyPaid ? 0 : order.advance_paid_paise,
    fulfilmentStatus: (
      { placed: "PLACED", confirmed: "CONFIRMED", delivered: "DELIVERED", cancelled: "CANCELLED" } as const
    )[order.status],
    cancelledAt: cancelled ? createdAt : null,
  };
}

async function writeSampleOrder(
  tx: Prisma.TransactionClient,
  vendorId: string,
  order: DemoSampleOrderInput,
  menu: Map<string, { id: string; name: string; priceInPaise: number }>,
  createdAt: Date,
): Promise<void> {
  const lines = order.lines.map((l) => {
    const item = menu.get(itemKey(l.item));
    // The schema already rejected unknown items; this is the type guard.
    if (!item) throw new DemoStoreError(400, "unknown_item");
    return { item, qty: l.qty };
  });
  const { subtotalPaise, totalPaise } = computeOrderTotals(
    lines.map((l) => ({ priceInPaise: l.item.priceInPaise, qty: l.qty })),
    0,
  );
  const billNumber = await nextBillNumber(tx, vendorId, createdAt);

  const created = await tx.transaction.create({
    data: {
      vendorId,
      billNumber,
      subtotalPaise,
      totalPaise,
      ...samplePaymentFields(order, totalPaise, createdAt),
      customerName: order.customer_name,
      customerPhone: normaliseIndianMobile(order.customer_phone),
      source: "STOREFRONT",
      fulfilmentType: "PICKUP",
      fulfilAt: order.event_date ? new Date(order.event_date) : null,
      orderToken: generateOrderToken(),
      isSample: true,
      createdAt,
      orderItems: {
        create: lines.map((l) => ({
          menuItemId: l.item.id,
          name: l.item.name,
          priceInPaise: l.item.priceInPaise,
          qty: l.qty,
          totalPaise: l.item.priceInPaise * l.qty,
        })),
      },
    },
    select: { id: true },
  });
  await tx.receipt.create({
    data: {
      transactionId: created.id,
      vendorId,
      receiptNumber: billNumber,
      publicToken: generateReceiptToken(),
      createdAt,
    },
  });
}

// ─── Read ───────────────────────────────────────────────────────────

export async function getDemoStore(externalRef: string) {
  const v = await prisma.vendor.findUnique({
    where: { demoExternalRef: externalRef },
    select: {
      id: true,
      slug: true,
      name: true,
      isDemo: true,
      createdAt: true,
      _count: { select: { menuItems: true, transactions: { where: { isSample: true } } } },
      demoHandovers: {
        where: { usedAt: null },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { expiresAt: true },
      },
    },
  });
  if (!v) return null;
  const pending = v.demoHandovers[0];
  return {
    store_id: v.id,
    external_ref: externalRef,
    slug: v.slug,
    name: v.name,
    public_url: publicStoreUrl(v.slug),
    is_demo: v.isDemo,
    created_at: v.createdAt.toISOString(),
    item_count: v._count.menuItems,
    sample_order_count: v._count.transactions,
    pending_handover: pending ? { expires_at: pending.expiresAt.toISOString() } : null,
  };
}

// ─── Delete ─────────────────────────────────────────────────────────

/** Deletes a demo store and everything under it. A claimed store is refused (409). */
export async function deleteDemoStore(externalRef: string, actor: string): Promise<void> {
  const v = await prisma.vendor.findUnique({
    where: { demoExternalRef: externalRef },
    select: { id: true, isDemo: true },
  });
  if (!v) throw new DemoStoreError(404, "not_found");
  if (!v.isDemo) throw new DemoStoreError(409, "not_a_demo_store");

  await prisma.$transaction(async (tx) => {
    // receipts.vendorId is ON DELETE RESTRICT, so a vendor with bills can't be
    // deleted in one statement: bills first (order items and receipts cascade
    // from the transaction), then the vendor. Every step is scoped to a store
    // that is still a demo, so one claimed meanwhile is left alone.
    const scope = { vendorId: v.id, vendor: { isDemo: true } };
    await tx.receipt.deleteMany({ where: scope });
    await tx.transaction.deleteMany({ where: scope });
    const res = await tx.vendor.deleteMany({ where: { id: v.id, isDemo: true } });
    if (res.count !== 1) throw new DemoStoreError(409, "not_a_demo_store");
    await tx.demoAuditLog.create({ data: { action: "delete", externalRef, vendorId: v.id, actor } });
  });
}

// ─── Handover ───────────────────────────────────────────────────────

/**
 * A one-time claim link for `email`, valid DEMO_CLAIM_TTL_DAYS. Sends nothing
 * and creates no account. A new invite voids the store's earlier unused ones.
 */
export async function createHandover(externalRef: string, email: string, actor: string, now: Date = new Date()) {
  const v = await prisma.vendor.findUnique({
    where: { demoExternalRef: externalRef },
    select: { id: true, isDemo: true },
  });
  if (!v) throw new DemoStoreError(404, "not_found");
  if (!v.isDemo) throw new DemoStoreError(409, "not_a_demo_store");

  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(now.getTime() + DEMO_CLAIM_TTL_DAYS * DAY_MS);
  await prisma.$transaction([
    prisma.demoHandover.deleteMany({ where: { vendorId: v.id, usedAt: null } }),
    prisma.demoHandover.create({ data: { vendorId: v.id, email, tokenHash: hashClaimToken(token), expiresAt } }),
    prisma.demoAuditLog.create({ data: { action: "handover", externalRef, vendorId: v.id, actor } }),
  ]);
  return { claim_url: claimUrl(token), expires_at: expiresAt.toISOString() };
}

/** What the claim page shows before the prospect sets a password. null = no usable invite. */
export async function loadClaim(token: string, now: Date = new Date()) {
  const h = await prisma.demoHandover.findUnique({
    where: { tokenHash: hashClaimToken(token) },
    select: { email: true, usedAt: true, expiresAt: true, vendor: { select: { name: true, isDemo: true } } },
  });
  if (!h || h.usedAt || h.expiresAt <= now || !h.vendor.isDemo) return null;
  return { email: h.email, storeName: h.vendor.name };
}

export type ClaimInput = {
  token: string;
  name: string;
  password: string;
  /** What happens to the sample orders: hidden from every list, or removed. */
  sampleOrders: "archive" | "delete";
};

/**
 * The prospect takes the store: their User is created with their own password,
 * they become its OWNER, the demo account leaves, `isDemo` flips, the trial
 * starts and the sample orders are archived or deleted — one transaction, the
 * token burned first so a second use fails.
 */
export async function claimDemoStore(input: ClaimInput, now: Date = new Date()): Promise<{ slug: string; email: string }> {
  const h = await prisma.demoHandover.findUnique({
    where: { tokenHash: hashClaimToken(input.token) },
    select: {
      id: true,
      email: true,
      vendorId: true,
      usedAt: true,
      expiresAt: true,
      vendor: { select: { demoExternalRef: true, isDemo: true } },
    },
  });
  // Re-checked atomically when the token is burned; this early answer only
  // keeps a used link from reporting "email in use".
  if (!h || h.usedAt || h.expiresAt <= now || !h.vendor.isDemo) {
    throw new DemoStoreError(400, "invalid_or_expired");
  }

  if (await prisma.user.findUnique({ where: { email: h.email }, select: { id: true } })) {
    throw new DemoStoreError(409, "email_in_use");
  }
  const passwordHash = await hashPassword(input.password);
  const name = input.name.trim();

  try {
    return await prisma.$transaction(async (tx) => {
      const burned = await tx.demoHandover.updateMany({
        where: { id: h.id, usedAt: null, expiresAt: { gt: now }, vendor: { isDemo: true } },
        data: { usedAt: now },
      });
      if (burned.count !== 1) throw new DemoStoreError(400, "invalid_or_expired");

      const user = await tx.user.create({ data: { email: h.email, name, passwordHash, role: "USER" } });
      const demoOwner = await demoOwnerId(tx);

      // Leave nothing of the demo account behind on this store.
      await tx.staffMember.deleteMany({ where: { vendorId: h.vendorId, userId: demoOwner } });
      await tx.pushSubscription.deleteMany({ where: { vendorId: h.vendorId, userId: demoOwner } });
      await tx.staffMember.create({ data: { vendorId: h.vendorId, userId: user.id, name, role: "OWNER" } });

      // The trial starts now, unless an admin already granted free access
      // further out (/admin/vendors moves trialEndsAt); never shorten that.
      const current = await tx.vendor.findUniqueOrThrow({ where: { id: h.vendorId }, select: { trialEndsAt: true } });
      const trialEnd = new Date(now.getTime() + TRIAL_DAYS * DAY_MS);
      const vendor = await tx.vendor.update({
        where: { id: h.vendorId },
        data: {
          isDemo: false,
          ownerName: name,
          email: h.email,
          // The placeholder must not take a real buyer's money: the owner adds
          // their own UPI id in Settings before taking payments.
          upiId: null,
          trialEndsAt: current.trialEndsAt && current.trialEndsAt > trialEnd ? current.trialEndsAt : trialEnd,
        },
        select: { slug: true },
      });

      if (input.sampleOrders === "delete") {
        await tx.transaction.deleteMany({ where: { vendorId: h.vendorId, isSample: true } });
      } else {
        await tx.transaction.updateMany({
          where: { vendorId: h.vendorId, isSample: true, archivedAt: null },
          data: { archivedAt: now },
        });
      }
      await tx.demoHandover.deleteMany({ where: { vendorId: h.vendorId, usedAt: null } });
      await tx.demoAuditLog.create({
        data: {
          action: "claim",
          externalRef: h.vendor.demoExternalRef ?? "",
          vendorId: h.vendorId,
          actor: "claim",
        },
      });
      return { slug: vendor.slug, email: h.email };
    });
  } catch (err) {
    if (isUniqueViolation(err, "email")) throw new DemoStoreError(409, "email_in_use");
    throw err;
  }
}
