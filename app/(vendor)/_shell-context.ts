import type { StaffRole } from "@prisma/client";
import { redirect } from "next/navigation";
import { cache } from "react";

import { displayStoreName } from "@/lib/demo-store-schema";
import { prisma } from "@/lib/prisma";
import { AuthError, requireVendorRole } from "@/lib/rbac";
import { storeKind, type StoreKind } from "@/lib/store-vocabulary";

export type ShellContext = {
  vendor: { id: string; name: string };
  /** The signed-in staff member's role at the active vendor; trims the nav for cashiers. */
  role: StaffRole;
  /** Public storefront path (`/s/<slug>`), or null while the store isn't published. */
  storePath: string | null;
  /** Kitchen or any other store: picks the words for the catalogue (lib/store-vocabulary.ts). */
  storeKind: StoreKind;
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
 *
 * It is also the setup gate: a store that hasn't finished first-run setup
 * (`Vendor.onboardingDone`) is sent to /onboarding from every page here, so a
 * deep link or a push notification can't skip it. Nothing is exempt: setup
 * saves through routes that never check billing, so even a locked trial can
 * finish it and then reach Billing. Staff other than the owner see a waiting
 * screen there (app/(onboarding)/layout.tsx).
 */
export const getShellContext = cache(async (): Promise<ShellContext> => {
  let ctx: Awaited<ReturnType<typeof requireVendorRole>>;
  try {
    ctx = await requireVendorRole("CASHIER");
  } catch (e) {
    if (e instanceof AuthError) redirect("/sign-in");
    throw e;
  }
  if (!ctx.vendor.onboardingDone) redirect("/onboarding");

  const settings = await prisma.vendorSettings.findUnique({
    where: { vendorId: ctx.vendor.id },
    select: { publishStorefront: true },
  });
  return {
    // "Prankie's Bakery (DEMO)" while it is an internal demo store (lib/demo-store.ts).
    vendor: { id: ctx.vendor.id, name: displayStoreName(ctx.vendor) },
    role: ctx.staff.role,
    storePath: settings?.publishStorefront ? `/s/${encodeURIComponent(ctx.vendor.slug)}` : null,
    storeKind: storeKind(ctx.vendor.stallType),
  };
});
