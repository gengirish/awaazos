import { FulfilmentMode, Prisma, StallType } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { SUPPORTED_VOICE_LANGS } from "@/lib/constants";
import { menuOrdersEnableBlocker, type MenuOrdersBlocker } from "@/lib/menu-orders-board";
import { prisma } from "@/lib/prisma";
import { requireVendorRole } from "@/lib/rbac";
import { UPI_ID_FORMAT_MESSAGE, UPI_ID_PATTERN } from "@/lib/upi";

// Served to cashiers: the encrypted Razorpay secrets must never leave the server
// (lib/storefront-razorpay.ts selects them explicitly where they are needed).
const SETTINGS_SECRET_OMIT = { razorpayKeySecretEnc: true, razorpayWebhookSecretEnc: true } as const;

const patchSchema = z.object({
  city: z.string().trim().min(1).max(80).optional(),
  state: z.string().trim().min(1).max(80).optional(),
  stallType: z.nativeEnum(StallType).optional(),
  // "" or null clears it; otherwise it must look like name@bank (lib/upi.ts).
  upiId: z
    .string()
    .trim()
    .max(120)
    .refine((v) => v === "" || UPI_ID_PATTERN.test(v), UPI_ID_FORMAT_MESSAGE)
    .optional()
    .nullable(),
  upiName: z.string().trim().max(120).optional().nullable(),
  onboardingDone: z.boolean().optional(),
  whatsappNumber: z.string().trim().max(20).optional().nullable(),
  voiceLang: z.enum(SUPPORTED_VOICE_LANGS).optional(),
  publishStorefront: z.boolean().optional(),
  // FSSAI registration/licence numbers are exactly 14 digits. "" clears it.
  fssaiNumber: z
    .union([z.string().trim().regex(/^\d{14}$/, "FSSAI number must be exactly 14 digits"), z.literal("")])
    .optional()
    .nullable(),
  acceptPayOnDelivery: z.boolean().optional(),
  // "Order from menu" (storefront orders without a Drop).
  acceptMenuOrders: z.boolean().optional(),
  menuFulfilmentMode: z.nativeEnum(FulfilmentMode).optional(),
  menuDeliveryFeePaise: z.number().int().min(0).max(100_000).optional(),
  // "" or null clears it.
  menuPickupNote: z.string().trim().max(200).optional().nullable(),
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

class SettingsConflict extends Error {
  constructor(public readonly code: MenuOrdersBlocker) {
    super(code);
  }
}

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
      include: { settings: { omit: SETTINGS_SECRET_OMIT } },
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
      // Turning "order from menu" on needs somewhere to order (a published
      // storefront) and a way to pay (UPI ID or pay on delivery). Checked
      // against the values this same request leaves behind.
      if (vendorFields.acceptMenuOrders === true) {
        const current = await tx.vendor.findUnique({
          where: { id: ctx.vendor.id },
          select: {
            upiId: true,
            settings: { select: { publishStorefront: true, acceptPayOnDelivery: true } },
          },
        });
        const blocker = menuOrdersEnableBlocker({
          publishStorefront: vendorFields.publishStorefront ?? current?.settings?.publishStorefront ?? false,
          upiId: vendorFields.upiId !== undefined ? vendorFields.upiId : current?.upiId,
          acceptPayOnDelivery:
            vendorFields.acceptPayOnDelivery ?? current?.settings?.acceptPayOnDelivery ?? false,
        });
        if (blocker) throw new SettingsConflict(blocker);
      }

      const data: Prisma.VendorUpdateInput = {};
      if (vendorFields.city !== undefined) data.city = vendorFields.city;
      if (vendorFields.state !== undefined) data.state = vendorFields.state;
      if (vendorFields.stallType !== undefined) data.stallType = vendorFields.stallType;
      if (vendorFields.upiId !== undefined) data.upiId = vendorFields.upiId || null;
      if (vendorFields.upiName !== undefined) data.upiName = vendorFields.upiName || null;
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
      if (vendorFields.publishStorefront !== undefined) {
        settingsUpdate.publishStorefront = vendorFields.publishStorefront;
      }
      if (vendorFields.fssaiNumber !== undefined) {
        settingsUpdate.fssaiNumber = vendorFields.fssaiNumber || null;
      }
      if (vendorFields.acceptPayOnDelivery !== undefined) {
        settingsUpdate.acceptPayOnDelivery = vendorFields.acceptPayOnDelivery;
      }
      if (vendorFields.acceptMenuOrders !== undefined) {
        settingsUpdate.acceptMenuOrders = vendorFields.acceptMenuOrders;
      }
      if (vendorFields.menuFulfilmentMode !== undefined) {
        settingsUpdate.menuFulfilmentMode = vendorFields.menuFulfilmentMode;
      }
      if (vendorFields.menuDeliveryFeePaise !== undefined) {
        settingsUpdate.menuDeliveryFeePaise = vendorFields.menuDeliveryFeePaise;
      }
      if (vendorFields.menuPickupNote !== undefined) {
        settingsUpdate.menuPickupNote = vendorFields.menuPickupNote || null;
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
      include: { settings: { omit: SETTINGS_SECRET_OMIT } },
    });

    const res = NextResponse.json({ vendor });
    return withVendorCookie(res, ctx.setVendorCookie);
  } catch (e) {
    if (e instanceof SettingsConflict) {
      return NextResponse.json({ error: e.code }, { status: 409 });
    }
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
