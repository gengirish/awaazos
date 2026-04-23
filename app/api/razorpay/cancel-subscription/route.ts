import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getRazorpay } from "@/lib/razorpay";
import { AuthError, requireVendorRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireVendorRole("OWNER", undefined, req);
    const settings = await prisma.vendorSettings.findUnique({
      where: { vendorId: ctx.vendor.id },
    });
    const subId = settings?.razorpaySubId;
    if (!subId) {
      return NextResponse.json({ error: "No Razorpay subscription on file." }, { status: 400 });
    }

    const rz = getRazorpay();
    await rz.subscriptions.cancel(subId, false);

    const tail = subId.length > 4 ? subId.slice(-4) : "****";
    console.info("[api/razorpay/cancel-subscription] cancelled sub …%s", tail);

    const res = NextResponse.json({ success: true });
    return withVendorCookie(res, ctx.setVendorCookie);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[api/razorpay/cancel-subscription]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
