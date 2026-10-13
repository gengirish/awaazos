import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { DropApiError, dropErrorResponse, notFound, withVendorCookie } from "@/lib/drops-api";
import { OFFER_RULE_SELECT, offerToDto, unknownOfferRefs } from "@/lib/offers-server";
import { prisma } from "@/lib/prisma";
import { requireVendorRole } from "@/lib/rbac";
import { offerInputToData, offerToggleSchema, offerUpsertSchema } from "@/lib/zod-offers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isMissingRow(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025";
}

/**
 * PATCH /api/offers/[id] — `{ isActive }` flips the switch; anything else is a
 * full replace. Compound `where`: another vendor's offer is a 404.
 */
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const ctx = await requireVendorRole("MANAGER", undefined, req);
    const json: unknown = await req.json();

    const toggle = offerToggleSchema.safeParse(json);
    let data: Prisma.OfferUpdateInput;
    if (toggle.success) {
      data = { isActive: toggle.data.isActive };
    } else {
      const full = offerInputToData(offerUpsertSchema.parse(json));
      const bad = await unknownOfferRefs(prisma, ctx.vendor.id, full);
      if (bad) throw new DropApiError(400, { error: bad });
      data = full;
    }

    try {
      const updated = await prisma.offer.update({
        where: { id: params.id, vendorId: ctx.vendor.id },
        data,
        select: OFFER_RULE_SELECT,
      });
      return withVendorCookie(NextResponse.json({ data: offerToDto(updated) }), ctx.setVendorCookie);
    } catch (e) {
      if (isMissingRow(e)) throw notFound();
      throw e;
    }
  } catch (err) {
    return dropErrorResponse(err, "api/offers PATCH");
  }
}

/**
 * DELETE /api/offers/[id]. Past bills keep their discount and the offer's name
 * (`Transaction.offerName` is a snapshot; `offerId` is set null).
 */
export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const ctx = await requireVendorRole("MANAGER", undefined, req);
    try {
      await prisma.offer.delete({ where: { id: params.id, vendorId: ctx.vendor.id } });
    } catch (e) {
      if (isMissingRow(e)) throw notFound();
      throw e;
    }
    return withVendorCookie(NextResponse.json({ success: true }), ctx.setVendorCookie);
  } catch (err) {
    return dropErrorResponse(err, "api/offers DELETE");
  }
}
