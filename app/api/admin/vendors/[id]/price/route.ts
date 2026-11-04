import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { setVendorCustomPrice } from "@/lib/admin-vendors";
import { rupeesToPaise } from "@/lib/currency";
import { logger } from "@/lib/logger";
import { AuthError, requirePlatformRole } from "@/lib/rbac";
import { isValidCustomPriceRupees } from "@/lib/subscription";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ monthlyRupees: z.number().nullable() });

const NOT_FOUND = { error: "Not found" };

/**
 * PATCH /api/admin/vendors/[id]/price: `{ monthlyRupees: 199 }`, or `null` for
 * the list price. Whole rupees, before GST (lib/subscription.ts).
 *
 * Platform SUPER_ADMIN only; anyone else gets the same 404 as an unknown vendor.
 * It takes effect when the owner next subscribes, so a live subscription is not
 * touched. Each change is written to the log as the audit trail.
 */
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const { user } = await requirePlatformRole("SUPER_ADMIN");
    const { monthlyRupees } = bodySchema.parse(await req.json());

    if (monthlyRupees !== null && !isValidCustomPriceRupees(monthlyRupees)) {
      return NextResponse.json({ error: "invalid_price" }, { status: 400 });
    }
    const customPricePaise = monthlyRupees === null ? null : rupeesToPaise(monthlyRupees);

    const result = await setVendorCustomPrice(params.id, customPricePaise);
    if (!result) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    logger.info(
      {
        route: "PATCH /api/admin/vendors/[id]/price",
        adminUserId: user.id,
        vendorId: result.vendor.id,
        previousPricePaise: result.previousPricePaise,
        customPricePaise,
      },
      "admin set store price",
    );

    return NextResponse.json({ data: { id: result.vendor.id, customPricePaise } });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", issues: err.issues }, { status: 400 });
    }
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    logger.error(
      {
        route: "PATCH /api/admin/vendors/[id]/price",
        error: err instanceof Error ? err.message : "unknown",
      },
      "admin set store price failed",
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
