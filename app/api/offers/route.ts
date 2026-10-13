import { NextRequest, NextResponse } from "next/server";

import { DropApiError, dropErrorResponse, withVendorCookie } from "@/lib/drops-api";
import { OFFER_RULE_SELECT, offerToDto, unknownOfferRefs } from "@/lib/offers-server";
import { prisma } from "@/lib/prisma";
import { requireVendorRole } from "@/lib/rbac";
import { offerInputToData, offerUpsertSchema } from "@/lib/zod-offers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** A vendor needs a handful of plans, not a catalogue of them. */
const MAX_OFFERS = 20;

/** GET /api/offers — this vendor's offers, oldest first (the order ties break in). */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireVendorRole("MANAGER", undefined, req);
    const offers = await prisma.offer.findMany({
      where: { vendorId: ctx.vendor.id },
      orderBy: [{ createdAt: "asc" }],
      select: OFFER_RULE_SELECT,
    });
    return withVendorCookie(NextResponse.json({ data: offers.map(offerToDto) }), ctx.setVendorCookie);
  } catch (err) {
    return dropErrorResponse(err, "api/offers GET");
  }
}

/** POST /api/offers — create an offer. Settings, so a locked vendor may still edit. */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireVendorRole("MANAGER", undefined, req);
    const data = offerInputToData(offerUpsertSchema.parse(await req.json()));

    const bad = await unknownOfferRefs(prisma, ctx.vendor.id, data);
    if (bad) throw new DropApiError(400, { error: bad });

    const count = await prisma.offer.count({ where: { vendorId: ctx.vendor.id } });
    if (count >= MAX_OFFERS) throw new DropApiError(409, { error: "offer_limit_reached", limit: MAX_OFFERS });

    const created = await prisma.offer.create({
      data: { ...data, vendorId: ctx.vendor.id },
      select: OFFER_RULE_SELECT,
    });
    return withVendorCookie(NextResponse.json({ data: offerToDto(created) }, { status: 201 }), ctx.setVendorCookie);
  } catch (err) {
    return dropErrorResponse(err, "api/offers POST");
  }
}
