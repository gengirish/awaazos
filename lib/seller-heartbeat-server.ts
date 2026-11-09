/**
 * Database side of the seller heartbeat (lib/seller-heartbeat.ts). Read on page
 * render only, never on a timer, so Neon can sleep.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { REAL_SALES, istDayStart } from "@/lib/admin-metrics";
import { publicStoreUrl } from "@/lib/demo-store";
import { prisma } from "@/lib/prisma";
import {
  type HeartbeatRow,
  type NudgeTemplateKey,
  SPARK_DAYS,
  buildHeartbeat,
  fillNudgeTemplate,
  nudgeTemplateKey,
} from "@/lib/seller-heartbeat";
import { storeContact } from "@/lib/store-contact";

/**
 * Real stores (not demo, still active) and their paid bills. Contact numbers are
 * read only when `withContacts`: owner contacts are SUPER_ADMIN-only (/admin/vendors).
 */
export async function loadSellerHeartbeat(
  now: Date,
  { withContacts }: { withContacts: boolean },
): Promise<HeartbeatRow[]> {
  const paid = { ...REAL_SALES, paymentStatus: "PAID" } as const;
  const [vendors, lastPaid, bills] = await Promise.all([
    prisma.vendor.findMany({
      where: { isDemo: false, isActive: true },
      select: {
        id: true,
        name: true,
        slug: true,
        createdAt: true,
        ownerName: true,
        phone: withContacts,
        settings: withContacts ? { select: { whatsappNumber: true } } : false,
      },
    }),
    prisma.transaction.groupBy({ by: ["vendorId"], where: paid, _max: { paidAt: true } }),
    prisma.transaction.findMany({
      where: { ...paid, paidAt: { gte: istDayStart(SPARK_DAYS, now), lt: istDayStart(0, now) } },
      select: { vendorId: true, paidAt: true, totalPaise: true, source: true },
    }),
  ]);

  const lastPaidBy = new Map(lastPaid.map((g) => [g.vendorId, g._max.paidAt]));
  const sellers = vendors.map((v) => {
    const phone = withContacts
      ? (storeContact({ owners: [], email: null, phone: v.phone ?? null, whatsappNumber: v.settings?.whatsappNumber ?? null })
          .phones[0]?.number ?? null)
      : null;
    return {
      id: v.id,
      name: v.name,
      slug: v.slug,
      createdAt: v.createdAt,
      lastPaidAt: lastPaidBy.get(v.id) ?? null,
      ownerName: v.ownerName,
      phone,
    };
  });
  const paidBills = bills.flatMap((b) => (b.paidAt ? [{ ...b, paidAt: b.paidAt }] : []));
  return buildHeartbeat(sellers, paidBills, now);
}

const TEMPLATE_KEYS: readonly NudgeTemplateKey[] = ["at-risk", "never-paid", "watch", "new", "healthy"];

/**
 * The copy in content/admin-nudges/, read per render so an edited file shows up
 * on the next deploy without a code change. The folder is traced into the
 * serverless bundle by `outputFileTracingIncludes` in next.config.mjs.
 */
export async function loadNudgeTemplates(): Promise<Record<NudgeTemplateKey, string>> {
  const dir = path.join(process.cwd(), "content", "admin-nudges");
  const entries = await Promise.all(
    TEMPLATE_KEYS.map(async (key) => [key, await readFile(path.join(dir, `${key}.txt`), "utf8")] as const),
  );
  return Object.fromEntries(entries) as Record<NudgeTemplateKey, string>;
}

export function nudgeMessageFor(
  row: HeartbeatRow,
  templates: Record<NudgeTemplateKey, string>,
  senderName: string | null,
): string {
  return fillNudgeTemplate(templates[nudgeTemplateKey(row)], {
    firstName: row.ownerName,
    senderName,
    storeName: row.name,
    storeUrl: publicStoreUrl(row.slug),
    daysIdle: row.daysIdle,
  });
}
