import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { DropApiError, dropErrorResponse, notFound, withVendorCookie } from "@/lib/drops-api";
import { duplicateDropFields } from "@/lib/drops-builder";
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
 * keep the source drop's prices and caps, and settings (incl. showEverydayMenu)
 * carry over. The copy is always a DRAFT.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
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

    let fields;
    try {
      fields = duplicateDropFields(src, date);
    } catch {
      throw new DropApiError(400, {
        error: "Invalid input",
        issues: [{ code: "custom", path: ["date"], message: "Invalid date" }],
      });
    }

    const created = await prisma.drop.create({
      data: {
        vendorId,
        status: "DRAFT",
        ...fields,
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
