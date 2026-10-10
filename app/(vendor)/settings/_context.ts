import { redirect } from "next/navigation";
import { cache } from "react";

import { AuthError, requireVendorRole } from "@/lib/rbac";

/**
 * Every Settings page is readable by any staff member (CASHIER+); owner-only
 * controls are disabled in the client components. Signed-out → /sign-in.
 *
 * Wrapped in React `cache` so the settings layout (Sign out button) and the
 * page share one lookup per request.
 */
export const requireSettingsContext = cache(async () => {
  try {
    const ctx = await requireVendorRole("CASHIER");
    return {
      vendor: ctx.vendor,
      access: ctx.access,
      isOwner: ctx.staff.role === "OWNER",
      user: { name: ctx.user.name, email: ctx.user.email },
    };
  } catch (e) {
    if (e instanceof AuthError) redirect("/sign-in");
    throw e;
  }
});
