import type { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import {
  conflict,
  dropErrorResponse,
  dropWithItemsInclude,
  liveDropOrderWhere,
  notFound,
  serializeDrop,
  withVendorCookie,
} from "@/lib/drops-api";
import { canTransition, effectiveDropStatus, soldQtyByDropItem } from "@/lib/drops";
import { prisma } from "@/lib/prisma";
import { requireVendorRole } from "@/lib/rbac";
import { dropStatusChangeSchema } from "@/lib/zod-drops";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * PATCH /api/drops/[id]/status — vendor-driven status change.
 * The cut-off itself is never stored (lib/drops.ts), so `from` is the
 * *effective* status.
 */
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const ctx = await requireVendorRole("MANAGER", undefined, req);
    const vendorId = ctx.vendor.id;
    const { status: to } = dropStatusChangeSchema.parse(await req.json());
    const now = new Date();

    const drop = await prisma.drop.findFirst({
      where: { id: params.id, vendorId },
      select: { id: true, status: true, opensAt: true, closesAt: true, _count: { select: { items: true } } },
    });
    if (!drop) throw notFound();

    if (!canTransition(effectiveDropStatus(drop, now), to)) throw conflict("invalid_transition");

    if (to === "OPEN") {
      if (now.getTime() >= drop.closesAt.getTime()) throw conflict("move_cutoff_first");
      if (drop._count.items === 0) throw conflict("no_items");
      const settings = await prisma.vendorSettings.findUnique({
        where: { vendorId },
        select: { acceptPayOnDelivery: true, publishStorefront: true },
      });
      if (!ctx.vendor.upiId && !settings?.acceptPayOnDelivery) throw conflict("no_payment_method");
      if (!settings?.publishStorefront) throw conflict("storefront_not_published");
    }

    const data: Prisma.DropUpdateManyMutationInput = { status: to };
    if (to === "FROZEN") data.frozenAt = now;
    else if (drop.status === "FROZEN") data.frozenAt = null;

    // Compound where + expected current status: a concurrent change loses cleanly.
    const res = await prisma.drop.updateMany({
      where: { id: drop.id, vendorId, status: drop.status },
      data,
    });
    if (res.count === 0) throw conflict("stale");

    const updated = await prisma.drop.findFirst({
      where: { id: drop.id, vendorId },
      include: dropWithItemsInclude,
    });
    if (!updated) throw notFound();
    const [sold, orderCount] = await Promise.all([
      soldQtyByDropItem(prisma, drop.id, now),
      prisma.transaction.count({ where: { vendorId, dropId: drop.id, ...liveDropOrderWhere } }),
    ]);

    return withVendorCookie(
      NextResponse.json({ data: serializeDrop(updated, { sold, orderCount, now }) }),
      ctx.setVendorCookie,
    );
  } catch (err) {
    return dropErrorResponse(err, "api/drops/[id]/status PATCH");
  }
}
