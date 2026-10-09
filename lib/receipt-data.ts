import { randomBytes } from "node:crypto";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { vendorLocationLine, publicReceiptUrl, type ReceiptView } from "@/lib/receipt";
import { appBaseUrl } from "@/lib/storefront-razorpay";
import { receiptStorefrontUrl } from "@/lib/whatsapp-message";

/**
 * Server-side half of the receipt module (pure half: lib/receipt.ts).
 *
 * Every read goes through `RECEIPT_TX_SELECT`, a hand-written allowlist. It
 * never selects `customerPhone`, `customerName`, `upiRef`, `deliveryAddress`
 * or `Vendor.phone` / `Vendor.email`, so neither the print page nor the
 * public `/r/[token]` page can render them by accident.
 */

/** 32 url-safe chars, 192 bits — same strength as `Transaction.orderToken`. */
export function generateReceiptToken(): string {
  return randomBytes(24).toString("base64url");
}

const RECEIPT_TX_SELECT = {
  id: true,
  billNumber: true,
  createdAt: true,
  subtotalPaise: true,
  discountPaise: true,
  deliveryFeePaise: true,
  taxPaise: true,
  totalPaise: true,
  paymentMethod: true,
  paymentStatus: true,
  source: true,
  cancelledAt: true,
  fulfilmentStatus: true,
  orderItems: {
    select: { name: true, qty: true, priceInPaise: true, menuItem: { select: { hsnCode: true } } },
    orderBy: { id: "asc" },
  },
  receipt: { select: { id: true, publicToken: true } },
  vendor: {
    select: {
      id: true,
      slug: true,
      name: true,
      city: true,
      state: true,
      gstin: true,
      settings: { select: { receiptFooter: true, fssaiNumber: true, publishStorefront: true, receiptPaper: true } },
    },
  },
} satisfies Prisma.TransactionSelect;

type ReceiptRow = Prisma.TransactionGetPayload<{ select: typeof RECEIPT_TX_SELECT }>;

/**
 * What the receipt says about payment. A counter sale only exists because the
 * cashier tapped "Mark paid"; a UPI one without the optional UTR is stored as
 * PENDING (unverified), but the customer did pay, so the receipt says paid.
 * Storefront orders can genuinely be unpaid and keep their stored status.
 */
export function receiptPaymentStatus(row: Pick<ReceiptRow, "paymentStatus" | "source">): ReceiptRow["paymentStatus"] {
  return row.source !== "STOREFRONT" && row.paymentStatus === "PENDING" ? "PAID" : row.paymentStatus;
}

function toView(row: ReceiptRow, publicToken: string | null, baseUrl: string): ReceiptView {
  const s = row.vendor.settings;
  return {
    vendorName: row.vendor.name,
    vendorLocation: vendorLocationLine(row.vendor.city, row.vendor.state),
    gstin: row.vendor.gstin,
    fssaiNumber: s?.fssaiNumber ?? null,
    billNumber: row.billNumber,
    createdAt: row.createdAt,
    items: row.orderItems.map((o) => ({
      name: o.name,
      qty: o.qty,
      priceInPaise: o.priceInPaise,
      hsnCode: o.menuItem?.hsnCode ?? null,
    })),
    subtotalPaise: row.subtotalPaise,
    discountPaise: row.discountPaise,
    deliveryFeePaise: row.deliveryFeePaise,
    taxPaise: row.taxPaise,
    totalPaise: row.totalPaise,
    paymentMethod: row.paymentMethod,
    paymentStatus: receiptPaymentStatus(row),
    cancelled: row.cancelledAt != null || row.fulfilmentStatus === "CANCELLED",
    receiptFooter: s?.receiptFooter ?? null,
    storefrontUrl: receiptStorefrontUrl({
      slug: row.vendor.slug,
      publishStorefront: s?.publishStorefront,
      baseUrl,
    }),
    receiptUrl: publicReceiptUrl(publicToken, baseUrl),
  };
}

/**
 * The receipt's public token, creating the Receipt row and/or token if this
 * bill predates them. Race-safe: two concurrent first shares both end up
 * returning whichever token won the conditional update.
 */
async function ensurePublicToken(row: ReceiptRow): Promise<string> {
  if (row.receipt?.publicToken) return row.receipt.publicToken;
  const token = generateReceiptToken();
  if (!row.receipt) {
    const created = await prisma.receipt.upsert({
      where: { transactionId: row.id },
      create: {
        transactionId: row.id,
        vendorId: row.vendor.id,
        receiptNumber: row.billNumber,
        publicToken: token,
      },
      update: {},
      select: { publicToken: true },
    });
    if (created.publicToken) return created.publicToken;
  }
  await prisma.receipt.updateMany({
    where: { transactionId: row.id, vendorId: row.vendor.id, publicToken: null },
    data: { publicToken: token },
  });
  const after = await prisma.receipt.findFirst({
    where: { transactionId: row.id, vendorId: row.vendor.id },
    select: { publicToken: true },
  });
  return after?.publicToken ?? token;
}

export type VendorReceipt = {
  view: ReceiptView;
  receiptPaper: NonNullable<ReceiptRow["vendor"]["settings"]>["receiptPaper"];
};

/**
 * A bill's receipt for staff of `vendorId`. Vendor-scoped lookup: another
 * tenant's id or bill number is a miss (callers answer 404). Hands out a
 * public token on first use so the receipt can be shared.
 */
export async function loadVendorReceipt(
  vendorId: string,
  ref: { transactionId: string } | { billNumber: string },
): Promise<VendorReceipt | null> {
  const where: Prisma.TransactionWhereInput =
    "transactionId" in ref ? { id: ref.transactionId, vendorId } : { billNumber: ref.billNumber, vendorId };
  const row = await prisma.transaction.findFirst({ where, select: RECEIPT_TX_SELECT });
  if (!row) return null;
  const token = await ensurePublicToken(row);
  return {
    view: toView(row, token, appBaseUrl()),
    receiptPaper: row.vendor.settings?.receiptPaper ?? "MM80",
  };
}

/** The customer's receipt page. Null for an unknown token or an inactive vendor. */
export async function loadPublicReceipt(token: string): Promise<ReceiptView | null> {
  if (!token || token.length > 64) return null;
  const row = await prisma.transaction.findFirst({
    where: { receipt: { is: { publicToken: token } }, vendor: { isActive: true } },
    select: RECEIPT_TX_SELECT,
  });
  return row ? toView(row, token, appBaseUrl()) : null;
}
