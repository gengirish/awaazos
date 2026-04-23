import { PaymentMethod } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { AuthError, requireVendorRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// STUB — Phase 3b replaces with prisma.$transaction + BillSequence

const postBodySchema = z.object({
  items: z
    .array(
      z.object({
        menuItemId: z.string().min(1),
        name: z.string().min(1),
        priceInPaise: z.number().int(),
        qty: z.number().int().positive(),
      }),
    )
    .min(1),
  subtotalPaise: z.number().int(),
  taxPaise: z.number().int(),
  totalPaise: z.number().int(),
  paymentMethod: z.nativeEnum(PaymentMethod),
  upiRef: z.string().max(120).optional().nullable(),
});

function istYyyymmdd(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  return `${y}${m}${d}`;
}

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

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireVendorRole("CASHIER", undefined, req);
    const res = NextResponse.json({ items: [], total: 0, _stub: true });
    return withVendorCookie(res, ctx.setVendorCookie);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[api/transactions GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireVendorRole("CASHIER", undefined, req);
    let json: unknown;
    try {
      json = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }
    const parsed = postBodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed.", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const body = parsed.data;
    const billNumber = `AWZ-${istYyyymmdd()}-STUB-${String(Date.now() % 10000).padStart(4, "0")}`;
    const createdAt = new Date().toISOString();
    const id = `stub_txn_${Date.now()}`;

    const res = NextResponse.json({
      transaction: {
        id,
        billNumber,
        totalPaise: body.totalPaise,
        paymentMethod: body.paymentMethod,
        createdAt,
      },
      receiptNumber: billNumber,
      _stub: true,
    });
    return withVendorCookie(res, ctx.setVendorCookie);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[api/transactions POST]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
