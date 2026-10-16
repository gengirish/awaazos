import { FulfilmentMode, Prisma, ReceiptPaper, StallType } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { SUPPORTED_VOICE_LANGS } from "@/lib/constants";
import { deliveryRidersSchema } from "@/lib/delivery-riders";
import { INSTAGRAM_HANDLE_MESSAGE, normaliseInstagramHandle } from "@/lib/instagram";
import { menuOrdersEnableBlocker, type MenuOrdersBlocker } from "@/lib/menu-orders-board";
import {
  dropWillTakeOrdersWhere,
  hasPaymentMethod,
  LAST_PAYMENT_METHOD_ERROR,
  lastPaymentMethodBlockers,
  type PaymentGuardBlocker,
} from "@/lib/payment-guard";
import { normaliseIndianMobile } from "@/lib/phone";
import { prisma } from "@/lib/prisma";
import { requireVendorRole } from "@/lib/rbac";
import { GSTIN_FORMAT_MESSAGE, GSTIN_PATTERN, RECEIPT_FOOTER_MAX } from "@/lib/receipt";
import { storeHandleSchema } from "@/lib/store-handle";
import { storeNameSchema } from "@/lib/store-name";
import { buyerWhatsappNumber } from "@/lib/storefront-order";
import { UPI_ID_FORMAT_MESSAGE, UPI_ID_PATTERN } from "@/lib/upi";

// Served to cashiers: the encrypted Razorpay secrets must never leave the server
// (lib/storefront-razorpay.ts selects them explicitly where they are needed).
const SETTINGS_SECRET_OMIT = { razorpayKeySecretEnc: true, razorpayWebhookSecretEnc: true } as const;

const patchSchema = z.object({
  // Store display name (Settings → Online store). Renaming never touches the
  // link; that is `slug` below, its own field with its own confirmation.
  name: storeNameSchema.optional(),
  // The store link, /s/<slug> (Settings → Online store, OWNER). Changing it
  // retires the old link at once: anything printed or posted with it stops
  // working, which the UI says before it sends this. 409 store_handle_taken.
  slug: storeHandleSchema.optional(),
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
  // Show whatsappNumber to storefront buyers (wa.me links). Off by default.
  acceptWhatsappOrders: z.boolean().optional(),
  // Show a WhatsApp chat link to every storefront visitor. Off by default.
  showWhatsappOnStore: z.boolean().optional(),
  // "@handle" or a profile URL; stored bare. "" or null clears it.
  instagramHandle: z
    .string()
    .trim()
    .max(200)
    .refine((v) => normaliseInstagramHandle(v) !== null, INSTAGRAM_HANDLE_MESSAGE)
    .transform((v) => normaliseInstagramHandle(v))
    .optional()
    .nullable(),
  voiceLang: z.enum(SUPPORTED_VOICE_LANGS).optional(),
  publishStorefront: z.boolean().optional(),
  // FSSAI registration/licence numbers are exactly 14 digits. "" clears it.
  fssaiNumber: z
    .union([z.string().trim().regex(/^\d{14}$/, "FSSAI number must be exactly 14 digits"), z.literal("")])
    .optional()
    .nullable(),
  acceptPayOnDelivery: z.boolean().optional(),
  // Receipts (Settings → Receipts). "" or null clears footer / GSTIN.
  receiptFooter: z.string().trim().max(RECEIPT_FOOTER_MAX).optional().nullable(),
  gstin: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .refine((v) => v === "" || GSTIN_PATTERN.test(v), GSTIN_FORMAT_MESSAGE)
    .optional()
    .nullable(),
  autoPrintReceipt: z.boolean().optional(),
  receiptPaper: z.nativeEnum(ReceiptPaper).optional(),
  // "Order from menu" (storefront orders without a Drop).
  acceptMenuOrders: z.boolean().optional(),
  menuFulfilmentMode: z.nativeEnum(FulfilmentMode).optional(),
  menuDeliveryFeePaise: z.number().int().min(0).max(100_000).optional(),
  // "" or null clears it.
  menuPickupNote: z.string().trim().max(200).optional().nullable(),
  // The seller's own delivery people (Settings → Online orders). The whole
  // list is replaced; [] removes every rider.
  deliveryRiders: deliveryRidersSchema.optional(),
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

/** Showing the number to buyers (after an order, or on the store page) needs a number that makes a working wa.me link. */
class WhatsappNumberRequired extends Error {
  constructor() {
    super("whatsapp_number_required");
  }
}

class StoreHandleTaken extends Error {
  constructor() {
    super("store_handle_taken");
  }
}

class LastPaymentMethodConflict extends Error {
  constructor(public readonly blockers: PaymentGuardBlocker[]) {
    super(LAST_PAYMENT_METHOD_ERROR);
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

    // One stored format (E.164 for Indian mobiles) so wa.me links don't depend on how it was typed.
    if (vendorFields.whatsappNumber) {
      vendorFields.whatsappNumber = normaliseIndianMobile(vendorFields.whatsappNumber);
    }

    await prisma.$transaction(async (tx) => {
      if (vendorFields.acceptWhatsappOrders === true || vendorFields.showWhatsappOnStore === true) {
        const number =
          vendorFields.whatsappNumber !== undefined
            ? vendorFields.whatsappNumber
            : (
                await tx.vendorSettings.findUnique({
                  where: { vendorId: ctx.vendor.id },
                  select: { whatsappNumber: true },
                })
              )?.whatsappNumber;
        if (!buyerWhatsappNumber({ acceptWhatsappOrders: true, whatsappNumber: number })) {
          throw new WhatsappNumberRequired();
        }
      }

      const touchesPayment = vendorFields.upiId !== undefined || vendorFields.acceptPayOnDelivery !== undefined;
      if (vendorFields.acceptMenuOrders === true || touchesPayment) {
        const current = await tx.vendor.findUnique({
          where: { id: ctx.vendor.id },
          select: {
            upiId: true,
            settings: { select: { publishStorefront: true, acceptPayOnDelivery: true, acceptMenuOrders: true } },
          },
        });
        // The values this same request leaves behind.
        const after = {
          publishStorefront: vendorFields.publishStorefront ?? current?.settings?.publishStorefront ?? false,
          upiId: vendorFields.upiId !== undefined ? vendorFields.upiId : current?.upiId,
          acceptPayOnDelivery: vendorFields.acceptPayOnDelivery ?? current?.settings?.acceptPayOnDelivery ?? false,
          acceptMenuOrders: vendorFields.acceptMenuOrders ?? current?.settings?.acceptMenuOrders ?? false,
        };

        // Turning "order from menu" on needs somewhere to order (a published
        // storefront) and a way to pay (UPI ID or pay on delivery).
        if (vendorFields.acceptMenuOrders === true) {
          const blocker = menuOrdersEnableBlocker(after);
          if (blocker) throw new SettingsConflict(blocker);
        }

        // The reverse (lib/payment-guard.ts): the last payment method can't go
        // while customers can still order online — menu orders on, or a drop
        // open or scheduled to open.
        if (touchesPayment && !hasPaymentMethod(after)) {
          const now = new Date();
          const drops = await tx.drop.findMany({
            where: { vendorId: ctx.vendor.id, ...dropWillTakeOrdersWhere(now) },
            select: { status: true, closesAt: true },
            take: 1,
          });
          const blockers = lastPaymentMethodBlockers({ ...after, drops }, now);
          if (blockers.length) throw new LastPaymentMethodConflict(blockers);
        }
      }

      const data: Prisma.VendorUpdateInput = {};
      if (vendorFields.name !== undefined) data.name = vendorFields.name;
      if (vendorFields.slug !== undefined && vendorFields.slug !== ctx.vendor.slug) {
        const taken = await tx.vendor.findUnique({ where: { slug: vendorFields.slug }, select: { id: true } });
        if (taken) throw new StoreHandleTaken();
        data.slug = vendorFields.slug;
      }
      if (vendorFields.city !== undefined) data.city = vendorFields.city;
      if (vendorFields.state !== undefined) data.state = vendorFields.state;
      if (vendorFields.stallType !== undefined) data.stallType = vendorFields.stallType;
      if (vendorFields.upiId !== undefined) data.upiId = vendorFields.upiId || null;
      if (vendorFields.upiName !== undefined) data.upiName = vendorFields.upiName || null;
      if (vendorFields.onboardingDone !== undefined) data.onboardingDone = vendorFields.onboardingDone;
      if (vendorFields.gstin !== undefined) data.gstin = vendorFields.gstin || null;

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
      if (vendorFields.acceptWhatsappOrders !== undefined) {
        settingsUpdate.acceptWhatsappOrders = vendorFields.acceptWhatsappOrders;
      }
      if (vendorFields.showWhatsappOnStore !== undefined) {
        settingsUpdate.showWhatsappOnStore = vendorFields.showWhatsappOnStore;
      }
      if (vendorFields.instagramHandle !== undefined) {
        settingsUpdate.instagramHandle = vendorFields.instagramHandle || null;
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
      if (vendorFields.receiptFooter !== undefined) {
        settingsUpdate.receiptFooter = vendorFields.receiptFooter || null;
      }
      if (vendorFields.autoPrintReceipt !== undefined) {
        settingsUpdate.autoPrintReceipt = vendorFields.autoPrintReceipt;
      }
      if (vendorFields.receiptPaper !== undefined) {
        settingsUpdate.receiptPaper = vendorFields.receiptPaper;
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
      if (vendorFields.deliveryRiders !== undefined) {
        settingsUpdate.deliveryRiders = vendorFields.deliveryRiders;
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
    // The active-vendor cookie holds the slug (lib/rbac.ts); after a link
    // change it must follow, or the next request falls back to the oldest
    // membership.
    const slugChanged = vendor && vendor.slug !== ctx.vendor.slug ? vendor.slug : null;
    return withVendorCookie(res, slugChanged ?? ctx.setVendorCookie);
  } catch (e) {
    if (e instanceof StoreHandleTaken) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      // Two owners racing for the same link: the unique index decides.
      return NextResponse.json({ error: "store_handle_taken" }, { status: 409 });
    }
    if (e instanceof SettingsConflict) {
      return NextResponse.json({ error: e.code }, { status: 409 });
    }
    if (e instanceof WhatsappNumberRequired) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    if (e instanceof LastPaymentMethodConflict) {
      return NextResponse.json({ error: LAST_PAYMENT_METHOD_ERROR, blockers: e.blockers }, { status: 409 });
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
