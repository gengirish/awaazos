import { StaffRole } from "@prisma/client";
import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Data-subject erasure endpoint (DPDP/GDPR-style right to deletion).
 *
 * Behaviour:
 * - Deletes the authenticated user account.
 * - If the user is the ONLY active OWNER of a vendor, that vendor is deleted
 *   as well (cascade removes menu, transactions, receipts, staff, logs).
 * - If a vendor has additional OWNERs, vendor data is preserved and only this
 *   user's membership is removed via user delete cascade.
 *
 * Caller should sign out on success.
 */
export async function DELETE() {
  try {
    const { user } = await requireUser();

    const summary = await prisma.$transaction(async (tx) => {
      const memberships = await tx.staffMember.findMany({
        where: { userId: user.id, isActive: true },
        select: { vendorId: true, role: true },
      });

      const ownerVendorIds = memberships
        .filter((m) => m.role === StaffRole.OWNER)
        .map((m) => m.vendorId);

      let deletedVendorIds: string[] = [];
      if (ownerVendorIds.length > 0) {
        const otherOwnerCounts = await tx.staffMember.groupBy({
          by: ["vendorId"],
          where: {
            vendorId: { in: ownerVendorIds },
            role: StaffRole.OWNER,
            isActive: true,
            NOT: { userId: user.id },
          },
          _count: { _all: true },
        });
        const byVendor = new Map(otherOwnerCounts.map((r) => [r.vendorId, r._count._all]));
        deletedVendorIds = ownerVendorIds.filter((id) => (byVendor.get(id) ?? 0) === 0);

        if (deletedVendorIds.length > 0) {
          await tx.vendor.deleteMany({
            where: { id: { in: deletedVendorIds } },
          });
        }
      }

      await tx.user.delete({ where: { id: user.id } });

      return {
        deletedUserId: user.id,
        deletedVendorIds,
        membershipsRemoved: memberships.length,
      };
    });

    logger.info(
      {
        event: "dsr_delete_me_success",
        userId: summary.deletedUserId,
        deletedVendorCount: summary.deletedVendorIds.length,
        membershipsRemoved: summary.membershipsRemoved,
      },
      "account deletion completed",
    );

    return NextResponse.json(
      {
        ok: true,
        ...summary,
        message: "Account deletion completed. Please sign in again if needed.",
      },
      { status: 200 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    if (message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    logger.error({ event: "dsr_delete_me_failed", error: message }, "account deletion failed");
    return NextResponse.json({ error: "Could not delete account" }, { status: 500 });
  }
}

