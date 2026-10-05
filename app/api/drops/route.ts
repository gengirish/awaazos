import { NextRequest, NextResponse } from "next/server";

import { liveDropOrderWhere, dropErrorResponse, unknownMenuItems, withVendorCookie } from "@/lib/drops-api";
import { effectiveDropStatus } from "@/lib/drops";
import { dbDateToYmd } from "@/lib/drops-time";
import { prisma } from "@/lib/prisma";
import { requireVendorRole } from "@/lib/rbac";
import { dropInputToData, dropUpsertSchema } from "@/lib/zod-drops";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/drops — this vendor's drops, newest cooking day first. */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireVendorRole("MANAGER", undefined, req);
    const now = new Date();
    const drops = await prisma.drop.findMany({
      where: { vendorId: ctx.vendor.id },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 100,
      include: {
        _count: { select: { items: true, transactions: { where: liveDropOrderWhere } } },
      },
    });

    const data = drops.map((d) => ({
      id: d.id,
      title: d.title,
      date: dbDateToYmd(d.date),
      fulfilmentMode: d.fulfilmentMode,
      fulfilmentStartsAt: d.fulfilmentStartsAt.toISOString(),
      fulfilmentEndsAt: d.fulfilmentEndsAt.toISOString(),
      opensAt: d.opensAt?.toISOString() ?? null,
      closesAt: d.closesAt.toISOString(),
      status: d.status,
      effectiveStatus: effectiveDropStatus(d, now),
      itemCount: d._count.items,
      orderCount: d._count.transactions,
    }));

    return withVendorCookie(NextResponse.json({ data }), ctx.setVendorCookie);
  } catch (err) {
    return dropErrorResponse(err, "api/drops GET");
  }
}

/** POST /api/drops — create a DRAFT drop. */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireVendorRole("MANAGER", undefined, req);
    const body = dropUpsertSchema.parse(await req.json());

    const owned = await prisma.menuItem.findMany({
      where: { vendorId: ctx.vendor.id, id: { in: body.items.map((i) => i.menuItemId) } },
      select: { id: true },
    });
    const bad = unknownMenuItems(body.items, new Set(owned.map((m) => m.id)));
    if (bad) throw bad;

    const created = await prisma.drop.create({
      data: {
        ...dropInputToData(body),
        vendorId: ctx.vendor.id,
        status: "DRAFT",
        items: {
          create: body.items.map((it, idx) => ({
            menuItemId: it.menuItemId,
            priceInPaise: it.priceInPaise,
            maxQty: it.maxQty,
            perOrderLimit: it.perOrderLimit,
            sortOrder: it.sortOrder || idx,
          })),
        },
      },
      select: { id: true, status: true },
    });

    return withVendorCookie(NextResponse.json({ data: created }, { status: 201 }), ctx.setVendorCookie);
  } catch (err) {
    return dropErrorResponse(err, "api/drops POST");
  }
}
