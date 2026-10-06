import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { AuthError, requireVendorRole } from "@/lib/rbac";
import { appBaseUrl } from "@/lib/storefront-razorpay";
import { formatWhatsAppReceiptMessage, receiptStorefrontUrl } from "@/lib/whatsapp-message";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const querySchema = z
  .object({
    transactionId: z.string().min(1).optional(),
    billNumber: z.string().min(1).optional(),
  })
  .refine((q) => Boolean(q.transactionId || q.billNumber), {
    message: "Either transactionId or billNumber is required",
    path: ["transactionId"],
  });

function withVendorCookie(res: NextResponse, slug: string | null) {
  if (slug) {
    res.cookies.set("awz_vendor", slug, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  }
  return res;
}

/**
 * Receipt text for a bill. The client wraps it in a wa.me link
 * (`receiptWhatsappUrl`) and the vendor sends it from their own WhatsApp —
 * no Business API, so it's free and available on every plan.
 *
 * The text carries no customer PII: the customer's number only ever lives in
 * the wa.me URL the vendor's browser builds.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireVendorRole("CASHIER", undefined, req);

    const parsed = querySchema.safeParse({
      transactionId: req.nextUrl.searchParams.get("transactionId") ?? undefined,
      billNumber: req.nextUrl.searchParams.get("billNumber") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
    }

    // Vendor-scoped lookup: a guessed id or bill number from another tenant is a 404.
    const where = parsed.data.transactionId
      ? { id: parsed.data.transactionId, vendorId: ctx.vendor.id }
      : { billNumber: parsed.data.billNumber!, vendorId: ctx.vendor.id };

    const tx = await prisma.transaction.findFirst({
      where,
      select: {
        billNumber: true,
        createdAt: true,
        taxPaise: true,
        totalPaise: true,
        orderItems: {
          select: { name: true, qty: true, priceInPaise: true, menuItem: { select: { hsnCode: true } } },
        },
      },
    });
    if (!tx) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const settings = await prisma.vendorSettings.findUnique({
      where: { vendorId: ctx.vendor.id },
      select: { receiptFooter: true, fssaiNumber: true, publishStorefront: true },
    });

    const text = formatWhatsAppReceiptMessage({
      vendorName: ctx.vendor.name,
      billNumber: tx.billNumber,
      createdAt: tx.createdAt,
      items: tx.orderItems.map((o) => ({
        name: o.name,
        qty: o.qty,
        priceInPaise: o.priceInPaise,
        hsnCode: o.menuItem?.hsnCode ?? null,
      })),
      taxPaise: tx.taxPaise,
      totalPaise: tx.totalPaise,
      receiptFooter: settings?.receiptFooter,
      fssaiNumber: settings?.fssaiNumber,
      storefrontUrl: receiptStorefrontUrl({
        slug: ctx.vendor.slug,
        publishStorefront: settings?.publishStorefront,
        baseUrl: appBaseUrl(),
      }),
    });

    const res = NextResponse.json({ data: { text } });
    return withVendorCookie(res, ctx.setVendorCookie);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message, code: err.message }, { status: err.status });
    }
    console.error("[api/receipts/message]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
