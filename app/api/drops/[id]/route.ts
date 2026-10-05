import { NextRequest, NextResponse } from "next/server";

import {
  conflict,
  dropErrorResponse,
  dropWithItemsInclude,
  liveDropOrderWhere,
  notFound,
  serializeDrop,
  unknownMenuItems,
  withVendorCookie,
} from "@/lib/drops-api";
import { planDropItemRemoval } from "@/lib/drops-builder";
import { soldQtyByDropItem } from "@/lib/drops";
import { prisma } from "@/lib/prisma";
import { requireVendorRole } from "@/lib/rbac";
import { dropInputToData, dropUpsertSchema } from "@/lib/zod-drops";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: { id: string } };

async function loadSerialized(vendorId: string, id: string, now: Date) {
  const drop = await prisma.drop.findFirst({ where: { id, vendorId }, include: dropWithItemsInclude });
  if (!drop) return null;
  const [sold, orderCount] = await Promise.all([
    soldQtyByDropItem(prisma, drop.id, now),
    prisma.transaction.count({ where: { vendorId, dropId: drop.id, ...liveDropOrderWhere } }),
  ]);
  return serializeDrop(drop, { sold, orderCount, now });
}

/** GET /api/drops/[id] — one drop with items, sold and remaining counts. */
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const ctx = await requireVendorRole("MANAGER", undefined, req);
    const data = await loadSerialized(ctx.vendor.id, params.id, new Date());
    if (!data) throw notFound();
    return withVendorCookie(NextResponse.json({ data }), ctx.setVendorCookie);
  } catch (err) {
    return dropErrorResponse(err, "api/drops/[id] GET");
  }
}

/**
 * PUT /api/drops/[id] — full replace. Items are synced by (dropId, menuItemId):
 * upserted if present, deleted if absent — unless a buyer already ordered one,
 * in which case the whole save is rejected (409 item_has_orders).
 */
export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const ctx = await requireVendorRole("MANAGER", undefined, req);
    const vendorId = ctx.vendor.id;
    const body = dropUpsertSchema.parse(await req.json());

    const owned = await prisma.menuItem.findMany({
      where: { vendorId, id: { in: body.items.map((i) => i.menuItemId) } },
      select: { id: true },
    });
    const bad = unknownMenuItems(body.items, new Set(owned.map((m) => m.id)));
    if (bad) throw bad;

    await prisma.$transaction(async (tx) => {
      // Same row lock placeStorefrontOrder takes: no order can land on an item
      // between our "has orders?" check and its deletion.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM drops WHERE id = ${params.id} AND "vendorId" = ${vendorId} FOR UPDATE`;
      if (locked.length === 0) throw notFound();

      const existing = await tx.drop.findFirst({
        where: { id: params.id, vendorId },
        select: {
          status: true,
          items: { select: { id: true, menuItemId: true, _count: { select: { orderItems: true } } } },
        },
      });
      if (!existing) throw notFound();
      if (existing.status === "FROZEN" || existing.status === "FULFILLED") throw conflict("drop_locked");

      const plan = planDropItemRemoval(
        existing.items.map((i) => ({ id: i.id, menuItemId: i.menuItemId, orderItemCount: i._count.orderItems })),
        body.items.map((i) => i.menuItemId),
      );
      if (plan.blockedMenuItemId) {
        throw conflict("item_has_orders", { menuItemId: plan.blockedMenuItemId });
      }

      await tx.drop.updateMany({ where: { id: params.id, vendorId }, data: dropInputToData(body) });
      if (plan.deleteIds.length) {
        await tx.dropItem.deleteMany({ where: { dropId: params.id, id: { in: plan.deleteIds } } });
      }
      for (let idx = 0; idx < body.items.length; idx++) {
        const it = body.items[idx];
        const fields = {
          priceInPaise: it.priceInPaise,
          maxQty: it.maxQty,
          perOrderLimit: it.perOrderLimit,
          sortOrder: it.sortOrder || idx,
        };
        await tx.dropItem.upsert({
          where: { dropId_menuItemId: { dropId: params.id, menuItemId: it.menuItemId } },
          create: { dropId: params.id, menuItemId: it.menuItemId, ...fields },
          update: fields,
        });
      }
    });

    const data = await loadSerialized(vendorId, params.id, new Date());
    if (!data) throw notFound();
    return withVendorCookie(NextResponse.json({ data }), ctx.setVendorCookie);
  } catch (err) {
    return dropErrorResponse(err, "api/drops/[id] PUT");
  }
}

/** DELETE /api/drops/[id] — only when no live storefront orders exist. */
export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const ctx = await requireVendorRole("MANAGER", undefined, req);
    const vendorId = ctx.vendor.id;

    await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM drops WHERE id = ${params.id} AND "vendorId" = ${vendorId} FOR UPDATE`;
      if (locked.length === 0) throw notFound();
      const orders = await tx.transaction.count({ where: { vendorId, dropId: params.id, ...liveDropOrderWhere } });
      if (orders > 0) throw conflict("has_orders");
      await tx.drop.deleteMany({ where: { id: params.id, vendorId } });
    });

    return withVendorCookie(NextResponse.json({ success: true }), ctx.setVendorCookie);
  } catch (err) {
    return dropErrorResponse(err, "api/drops/[id] DELETE");
  }
}
