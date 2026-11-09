/**
 * Database side of the order leak map (lib/order-funnel.ts). Read on page render
 * only, never on a timer, so Neon can sleep. Reads nothing about buyers: no
 * name, phone, address or UTR is selected, so none can reach the page.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { istDayStart, storefrontOrdersWhere } from "@/lib/admin-metrics";
import { fillAdminTemplate } from "@/lib/admin-template";
import { formatINR } from "@/lib/currency";
import { formatIstDateTime } from "@/lib/datetime";
import { type OrderFunnel, type StalledOrder, buildOrderFunnel } from "@/lib/order-funnel";
import { prisma } from "@/lib/prisma";
import { storeContact } from "@/lib/store-contact";
import { readStoreViews } from "@/lib/store-views";
import { appBaseUrl } from "@/lib/storefront-razorpay";

const WINDOW_DAYS = 7;

export type FunnelStore = {
  name: string;
  slug: string;
  ownerName: string | null;
  /** Seller's WhatsApp, else sign-up phone; null unless contacts were asked for. */
  phone: string | null;
};

export type LoadedOrderFunnel = OrderFunnel & {
  windowStart: Date;
  windowEnd: Date;
  stores: Record<string, FunnelStore>;
};

/**
 * The last 7 complete IST days, the same window as the cards above it. Seller
 * contacts are read only when `withContacts` (SUPER_ADMIN, as on /admin/vendors).
 */
export async function loadOrderFunnel(
  now: Date,
  { withContacts }: { withContacts: boolean },
): Promise<LoadedOrderFunnel> {
  const windowStart = istDayStart(WINDOW_DAYS, now);
  const windowEnd = istDayStart(0, now);
  const days = Array.from({ length: WINDOW_DAYS }, (_, i) => istDayStart(WINDOW_DAYS - i, now));

  const [rows, views] = await Promise.all([
    prisma.transaction.findMany({
      where: storefrontOrdersWhere({ gte: windowStart, lt: windowEnd }),
      select: {
        id: true,
        vendorId: true,
        billNumber: true,
        totalPaise: true,
        createdAt: true,
        orderChannel: true,
        paymentMethod: true,
        paymentStatus: true,
        razorpayOrderId: true,
        paymentClaimedAt: true,
        paymentRejectedAt: true,
        fulfilmentStatus: true,
      },
    }),
    readStoreViews(days),
  ]);

  const funnel = buildOrderFunnel({
    orders: rows.map(({ razorpayOrderId, ...o }) => ({ ...o, razorpayStarted: razorpayOrderId !== null })),
    views,
    windowStart,
  });

  const vendorIds = [...new Set(funnel.stalled.map((o) => o.vendorId))];
  const vendors = vendorIds.length
    ? await prisma.vendor.findMany({
        where: { id: { in: vendorIds } },
        select: {
          id: true,
          name: true,
          slug: true,
          ownerName: true,
          phone: withContacts,
          settings: withContacts ? { select: { whatsappNumber: true } } : false,
        },
      })
    : [];
  const stores: Record<string, FunnelStore> = {};
  for (const v of vendors) {
    const phone = withContacts
      ? (storeContact({ owners: [], email: null, phone: v.phone ?? null, whatsappNumber: v.settings?.whatsappNumber ?? null })
          .phones[0]?.number ?? null)
      : null;
    stores[v.id] = { name: v.name, slug: v.slug, ownerName: v.ownerName, phone };
  }

  return { ...funnel, windowStart, windowEnd, stores };
}

/** content/admin-nudges/stalled-order.txt, read per render (traced by next.config.mjs). */
export async function loadRemindTemplate(): Promise<string> {
  return readFile(path.join(process.cwd(), "content", "admin-nudges", "stalled-order.txt"), "utf8");
}

export function remindMessageFor(
  order: StalledOrder,
  store: FunnelStore,
  template: string,
  senderName: string | null,
): string {
  return fillAdminTemplate(template, {
    firstName: store.ownerName,
    senderName,
    values: {
      storeName: store.name,
      billNumber: order.billNumber,
      amount: formatINR(order.totalPaise),
      placedAt: `${formatIstDateTime(order.createdAt)} IST`,
      boardUrl: `${appBaseUrl()}/orders`,
    },
  });
}
