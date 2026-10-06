import { redirect } from "next/navigation";

import { AuthError, requireVendorRole } from "@/lib/rbac";

/**
 * Every Settings page is readable by any staff member (CASHIER+); owner-only
 * controls are disabled in the client components. Signed-out → /sign-in.
 */
export async function requireSettingsContext() {
  try {
    const ctx = await requireVendorRole("CASHIER");
    return { vendor: ctx.vendor, isOwner: ctx.staff.role === "OWNER" };
  } catch (e) {
    if (e instanceof AuthError) redirect("/sign-in");
    throw e;
  }
}
