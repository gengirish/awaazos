/**
 * What a SALES user (a sales intern, invited on /admin/admins) may touch: the
 * demo stores they built themselves. Ownership is the demo-store audit log's
 * "create" row (`actor` = "admin:<User.id>", lib/admin-api.ts), matched on the
 * vendor as well as the ref, so a ref deleted and rebuilt by someone else
 * doesn't stay theirs. ADMIN and SUPER_ADMIN pass straight through.
 *
 * Someone else's store answers like a missing one (404); only building on a
 * ref that is already taken says so (409), because the form has to explain it.
 */
import type { UserRole } from "@prisma/client";

import { DemoStoreError } from "@/lib/demo-store";
import { prisma } from "@/lib/prisma";

type Caller = { role: UserRole };

async function builtBy(actor: string, externalRef: string, vendorId: string): Promise<boolean> {
  const row = await prisma.demoAuditLog.findFirst({
    where: { action: "create", externalRef, vendorId, actor },
    select: { id: true },
  });
  return row !== null;
}

/** Handover, images: a SALES caller must have built this store. */
export async function assertSalesOwnsDemoStore(user: Caller, actor: string, externalRef: string): Promise<void> {
  if (user.role !== "SALES") return;
  const vendor = await prisma.vendor.findUnique({ where: { demoExternalRef: externalRef }, select: { id: true } });
  if (!vendor || !(await builtBy(actor, externalRef, vendor.id))) throw new DemoStoreError(404, "not_found");
}

/** Create: rebuilding your own ref stays idempotent; someone else's lead is refused. */
export async function assertSalesMayBuild(user: Caller, actor: string, externalRef: string): Promise<void> {
  if (user.role !== "SALES") return;
  const vendor = await prisma.vendor.findUnique({ where: { demoExternalRef: externalRef }, select: { id: true } });
  if (vendor && !(await builtBy(actor, externalRef, vendor.id))) throw new DemoStoreError(409, "lead_taken");
}

/** The vendor ids a SALES user's pipeline may list. */
export async function demoVendorIdsBuiltBy(actor: string): Promise<string[]> {
  const rows = await prisma.demoAuditLog.findMany({
    where: { action: "create", actor, vendorId: { not: null } },
    select: { vendorId: true },
  });
  return rows.flatMap((r) => (r.vendorId ? [r.vendorId] : []));
}
