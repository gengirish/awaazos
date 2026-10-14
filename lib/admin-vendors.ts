/**
 * Vendor list and free-access grant for the platform admin page `/admin/vendors`.
 *
 * Deliberately cross-tenant: these queries carry no `vendorId` scope, so every
 * caller must have passed `requirePlatformRole("SUPER_ADMIN")` first. The
 * select is an allowlist — no owner name, phone or email leaves this file.
 */
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export const ADMIN_VENDOR_LIST_LIMIT = 50;

const ADMIN_VENDOR_SELECT = {
  id: true,
  slug: true,
  name: true,
  plan: true,
  planExpiresAt: true,
  trialEndsAt: true,
  isActive: true,
  createdAt: true,
} satisfies Prisma.VendorSelect;

export type AdminVendorRow = Prisma.VendorGetPayload<{ select: typeof ADMIN_VENDOR_SELECT }>;

/** Newest stores first, optionally narrowed to a name or slug match. */
export function listAdminVendors(query: string): Promise<AdminVendorRow[]> {
  const q = query.trim();
  return prisma.vendor.findMany({
    where: q
      ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { slug: { contains: q, mode: "insensitive" } }] }
      : undefined,
    select: ADMIN_VENDOR_SELECT,
    orderBy: { createdAt: "desc" },
    take: ADMIN_VENDOR_LIST_LIMIT,
  });
}

/**
 * Move a vendor's `trialEndsAt` (see lib/admin-free-access.ts for why that
 * field). Returns the row before and after, or null for an unknown id.
 */
export async function setVendorFreeUntil(
  vendorId: string,
  endsAt: Date,
): Promise<{ previousTrialEndsAt: Date | null; vendor: AdminVendorRow } | null> {
  return prisma.$transaction(async (tx) => {
    const before = await tx.vendor.findUnique({ where: { id: vendorId }, select: { trialEndsAt: true } });
    if (!before) return null;
    const vendor = await tx.vendor.update({
      where: { id: vendorId },
      data: { trialEndsAt: endsAt },
      select: ADMIN_VENDOR_SELECT,
    });
    return { previousTrialEndsAt: before.trialEndsAt, vendor };
  });
}
