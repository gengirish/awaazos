import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { DropApiError, dropErrorResponse, notFound, withVendorCookie } from "@/lib/drops-api";
import { shiftDropSchedule } from "@/lib/drops-builder";
import { prisma } from "@/lib/prisma";
import { requireVendorRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
});

/**
 * POST /api/drops/[id]/duplicate — "copy yesterday's menu". One read, one
 * nested create. The whole schedule moves by the same number of days; items
 * keep the source drop's prices and caps. The copy is always a DRAFT.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireVendorRole("MANAGER", undefined, req);
    const vendorId = ctx.vendor.id;
    const { date } = bodySchema.parse(await req.json());

    const src = await prisma.drop.findFirst({
      where: { id: params.id, vendorId },
      include: {
        items: { select: { menuItemId: true, priceInPaise: true, maxQty: true, perOrderLimit: true, sortOrder: true } },
      },
    });
    if (!src) throw notFound();

    let schedule;
    try {
      schedule = shiftDropSchedule(src, date);
    } catch {
      throw new DropApiError(400, {
        error: "Invalid input",
        issues: [{ code: "custom", path: ["date"], message: "Invalid date" }],
      });
    }

    const created = await prisma.drop.create({
      data: {
        vendorId,
        title: src.title,
        note: src.note,
        fulfilmentMode: src.fulfilmentMode,
        pickupNote: src.pickupNote,
        deliveryFeePaise: src.deliveryFeePaise,
        status: "DRAFT",
        ...schedule,
        items: {
          create: src.items.map((i) => ({
            menuItemId: i.menuItemId,
            priceInPaise: i.priceInPaise,
            maxQty: i.maxQty,
            perOrderLimit: i.perOrderLimit,
            sortOrder: i.sortOrder,
          })),
        },
      },
      select: { id: true, status: true },
    });

    return withVendorCookie(NextResponse.json({ data: created }, { status: 201 }), ctx.setVendorCookie);
  } catch (err) {
    return dropErrorResponse(err, "api/drops/[id]/duplicate POST");
  }
}
