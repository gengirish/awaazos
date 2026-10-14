import type { StaffRole } from "@prisma/client";
import { redirect } from "next/navigation";
import { cache } from "react";

import { displayStoreName } from "@/lib/demo-store-schema";
import { prisma } from "@/lib/prisma";
import { AuthError, requireVendorRole } from "@/lib/rbac";

export type ShellContext = {
  vendor: { id: string; name: string };
  /** The signed-in staff member's role at the active vendor; trims the nav for cashiers. */
  role: StaffRole;
  /** Public storefront path (`/s/<slug>`), or null while the store isn't published. */
  storePath: string | null;
};

/**
 * What the app shell (layout.tsx) needs to draw navigation. Any staff member
 * may see the shell (CASHIER+); signed out or no membership → /sign-in, the
 * same place every page under it sends them.
 *
 * This is NOT the page's authorisation: each page keeps its own
 * `requireVendorRole(minRole)`. The user and membership reads behind that call
 * are request-cached in lib/rbac.ts, so the layout and the page share them;
 * the only read the shell adds is the one `publishStorefront` column below.
 */
export const getShellContext = cache(async (): Promise<ShellContext> => {
  try {
    const ctx = await requireVendorRole("CASHIER");
    const settings = await prisma.vendorSettings.findUnique({
      where: { vendorId: ctx.vendor.id },
      select: { publishStorefront: true },
    });
    return {
      // "Prankie's Bakery (DEMO)" while it is an internal demo store (lib/demo-store.ts).
      vendor: { id: ctx.vendor.id, name: displayStoreName(ctx.vendor) },
      role: ctx.staff.role,
      storePath: settings?.publishStorefront ? `/s/${encodeURIComponent(ctx.vendor.slug)}` : null,
    };
  } catch (e) {
    if (e instanceof AuthError) redirect("/sign-in");
    throw e;
  }
});
