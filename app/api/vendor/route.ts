import { Prisma, StallType } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { requireVendorRole } from "@/lib/rbac";

const patchSchema = z.object({
  city: z.string().trim().min(1).max(80).optional(),
  state: z.string().trim().min(1).max(80).optional(),
  stallType: z.nativeEnum(StallType).optional(),
  upiId: z.string().trim().max(120).optional().nullable(),
  upiName: z.string().trim().max(120).optional().nullable(),
  onboardingDone: z.boolean().optional(),
  whatsappNumber: z.string().trim().max(20).optional().nullable(),
  voiceLang: z.string().trim().min(5).max(12).optional(),
  menuItems: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        priceInPaise: z.number().int().positive(),
        emoji: z.string().max(8).optional(),
        aliases: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
      }),
    )
    .max(50)
    .optional(),
});

function withVendorCookie(res: NextResponse, slug: string | null) {
  if (slug) {
    res.cookies.set("awz_vendor", slug, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  }
  return res;
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireVendorRole("CASHIER", undefined, req);
    const vendor = await prisma.vendor.findUnique({
      where: { id: ctx.vendor.id },
      include: { settings: true },
    });
    if (!vendor) {
      return NextResponse.json({ error: "Vendor not found." }, { status: 404 });
    }
    const res = NextResponse.json({ vendor });
    return withVendorCookie(res, ctx.setVendorCookie);
  } catch (e) {
    const err = e as { status?: number; message?: string };
    if (err.message === "Unauthorized" || err.status === 401) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err.status === 403) {
      return NextResponse.json({ error: err.message ?? "Forbidden" }, { status: 403 });
    }
    throw e;
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireVendorRole("OWNER", undefined, req);
    let json: unknown;
    try {
      json = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }
    const parsed = patchSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed.", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { menuItems, ...vendorFields } = parsed.data;

    await prisma.$transaction(async (tx) => {
      const data: Prisma.VendorUpdateInput = {};
      if (vendorFields.city !== undefined) data.city = vendorFields.city;
      if (vendorFields.state !== undefined) data.state = vendorFields.state;
      if (vendorFields.stallType !== undefined) data.stallType = vendorFields.stallType;
      if (vendorFields.upiId !== undefined) data.upiId = vendorFields.upiId ?? null;
      if (vendorFields.upiName !== undefined) data.upiName = vendorFields.upiName ?? null;
      if (vendorFields.onboardingDone !== undefined) data.onboardingDone = vendorFields.onboardingDone;

      if (Object.keys(data).length) {
        await tx.vendor.update({
          where: { id: ctx.vendor.id },
          data,
        });
      }

      const settingsUpdate: Prisma.VendorSettingsUpdateInput = {};
      if (vendorFields.whatsappNumber !== undefined) {
        settingsUpdate.whatsappNumber = vendorFields.whatsappNumber ?? null;
      }
      if (vendorFields.voiceLang !== undefined) {
        settingsUpdate.voiceLang = vendorFields.voiceLang;
      }
      if (vendorFields.onboardingDone === true && vendorFields.whatsappNumber) {
        settingsUpdate.sendWhatsappReceipt = true;
      }

      if (Object.keys(settingsUpdate).length) {
        await tx.vendorSettings.update({
          where: { vendorId: ctx.vendor.id },
          data: settingsUpdate as Prisma.VendorSettingsUpdateInput,
        });
      }

      if (menuItems?.length) {
        const existing = await tx.menuItem.count({ where: { vendorId: ctx.vendor.id } });
        let sortBase = existing;
        for (const item of menuItems) {
          await tx.menuItem.create({
            data: {
              vendorId: ctx.vendor.id,
              name: item.name,
              priceInPaise: item.priceInPaise,
              emoji: item.emoji ?? "🍽️",
              aliases: item.aliases ?? [],
              sortOrder: sortBase++,
            },
          });
        }
      }
    });

    const vendor = await prisma.vendor.findUnique({
      where: { id: ctx.vendor.id },
      include: { settings: true },
    });

    const res = NextResponse.json({ vendor });
    return withVendorCookie(res, ctx.setVendorCookie);
  } catch (e) {
    const err = e as { status?: number; message?: string };
    if (err.message === "Unauthorized" || err.status === 401) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err.status === 403) {
      return NextResponse.json({ error: err.message ?? "Forbidden" }, { status: 403 });
    }
    throw e;
  }
}
