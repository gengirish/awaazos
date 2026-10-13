import { redirect } from "next/navigation";
import { cache } from "react";

import { AuthError, requireVendorRole, staffRoleAtLeast } from "@/lib/rbac";

/**
 * Every Settings page is readable by any staff member (CASHIER+); owner-only
 * controls are disabled in the client components. Signed-out → /sign-in.
 *
 * Wrapped in React `cache` so everything rendering one settings page shares
 * one lookup per request.
 */
export const requireSettingsContext = cache(async () => {
  try {
    const ctx = await requireVendorRole("CASHIER");
    return {
      vendor: ctx.vendor,
      access: ctx.access,
      isOwner: ctx.staff.role === "OWNER",
      /** MANAGER or OWNER: may edit offers (same floor as drops). */
      canManage: staffRoleAtLeast(ctx.staff.role, "MANAGER"),
      user: { name: ctx.user.name, email: ctx.user.email },
    };
  } catch (e) {
    if (e instanceof AuthError) redirect("/sign-in");
    throw e;
  }
});
