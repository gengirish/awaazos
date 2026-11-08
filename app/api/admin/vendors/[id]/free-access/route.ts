import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { parseFreeUntil } from "@/lib/admin-free-access";
import { setVendorFreeUntil } from "@/lib/admin-vendors";
import { logger } from "@/lib/logger";
import { AuthError, requirePlatformRole } from "@/lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ freeUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

const NOT_FOUND = { error: "Not found" };

/**
 * PATCH /api/admin/vendors/[id]/free-access — `{ freeUntil: "YYYY-MM-DD" }` (IST).
 *
 * Platform SUPER_ADMIN only. Lets a store use AwaazOS free until the end of
 * that day by moving `Vendor.trialEndsAt` (lib/admin-free-access.ts). Anyone
 * else gets the same 404 as an unknown vendor, so the route does not disclose
 * that it exists. Each grant is written to the log as the audit trail.
 */
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const { user } = await requirePlatformRole("SUPER_ADMIN");
    const body = bodySchema.parse(await req.json());

    const parsed = parseFreeUntil(body.freeUntil);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const result = await setVendorFreeUntil(params.id, parsed.endsAt);
    if (!result) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    logger.info(
      {
        route: "PATCH /api/admin/vendors/[id]/free-access",
        adminUserId: user.id,
        vendorId: result.vendor.id,
        previousTrialEndsAt: result.previousTrialEndsAt?.toISOString() ?? null,
        trialEndsAt: parsed.endsAt.toISOString(),
      },
      "admin granted free access",
    );

    return NextResponse.json({
      data: { id: result.vendor.id, trialEndsAt: parsed.endsAt.toISOString() },
    });
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
        route: "PATCH /api/admin/vendors/[id]/free-access",
        error: err instanceof Error ? err.message : "unknown",
      },
      "admin free access failed",
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
