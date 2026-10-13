import type { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import {
  DropApiError,
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
 *
 * Opening needs a published storefront. An OWNER can publish it in the same
 * request with `publishStorefront: true` (the edit page's one-tap confirm).
 */
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const ctx = await requireVendorRole("MANAGER", undefined, req);
    const vendorId = ctx.vendor.id;
    const { status: to, publishStorefront } = dropStatusChangeSchema.parse(await req.json());
    const now = new Date();
    // Set only when this request also publishes the storefront (see below).
    let publishStore = false;

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
      if (!settings?.publishStorefront) {
        // Publishing makes the menu world-readable, so opening a drop never
        // implies it: the client must ask for it, and only an OWNER may (the
        // same bar as PATCH /api/vendor).
        if (!publishStorefront) throw conflict("storefront_not_published");
        if (ctx.staff.role !== "OWNER") {
          throw new DropApiError(403, { error: "owner_required" });
        }
        publishStore = true;
      }
    }

    const data: Prisma.DropUpdateManyMutationInput = { status: to };
    if (to === "FROZEN") data.frozenAt = now;
    else if (drop.status === "FROZEN") data.frozenAt = null;

    // One transaction: the store is published only if the drop really opens.
    await prisma.$transaction(async (tx) => {
      // Compound where + expected current status: a concurrent change loses cleanly.
      const res = await tx.drop.updateMany({
        where: { id: drop.id, vendorId, status: drop.status },
        data,
      });
      if (res.count === 0) throw conflict("stale");
      if (publishStore) {
        await tx.vendorSettings.upsert({
          where: { vendorId },
          update: { publishStorefront: true },
          create: { vendorId, publishStorefront: true },
        });
      }
    });

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
