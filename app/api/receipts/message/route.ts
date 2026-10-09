import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { AuthError, requireVendorRole } from "@/lib/rbac";
import { loadVendorReceipt } from "@/lib/receipt-data";
import { formatWhatsAppReceiptMessage } from "@/lib/whatsapp-message";

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
 * the wa.me URL the vendor's browser builds. It links the customer's receipt
 * page (`receiptUrl`, /r/<token>); the first share of an older bill mints
 * that token, which is why this GET can write.
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
    const receipt = await loadVendorReceipt(
      ctx.vendor.id,
      parsed.data.transactionId
        ? { transactionId: parsed.data.transactionId }
        : { billNumber: parsed.data.billNumber! },
    );
    if (!receipt) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const text = formatWhatsAppReceiptMessage(receipt.view);

    const res = NextResponse.json({ data: { text, receiptUrl: receipt.view.receiptUrl } });
    return withVendorCookie(res, ctx.setVendorCookie);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message, code: err.message }, { status: err.status });
    }
    console.error("[api/receipts/message]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
