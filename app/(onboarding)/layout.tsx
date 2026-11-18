import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { displayStoreName } from "@/lib/demo-store-schema";
import { HOME_PATH } from "@/lib/home";
import { AuthError, requireVendorRole } from "@/lib/rbac";

import { SignOutLink } from "./SignOutLink";
import { BRAND_NAME } from "@/lib/brand";

export const dynamic = "force-dynamic";

export const metadata = { title: `Set up your store · ${BRAND_NAME}`, robots: { index: false, follow: false } };

/**
 * First-run setup. Every vendor page sends an unfinished store here
 * (app/(vendor)/_shell-context.ts), so this is where the rule ends:
 *
 *   finished              → /home (real 307, before any form loads)
 *   owner                 → the setup form
 *   anyone else on staff  → a waiting screen: every step saves through
 *                           PATCH /api/vendor, which is OWNER-only.
 */
export default async function OnboardingLayout({ children }: { children: ReactNode }) {
  let ctx: Awaited<ReturnType<typeof requireVendorRole>>;
  try {
    ctx = await requireVendorRole("CASHIER");
  } catch (e) {
    if (e instanceof AuthError) redirect("/sign-in?callbackUrl=/onboarding");
    throw e;
  }
  if (ctx.vendor.onboardingDone) redirect(HOME_PATH);
  if (ctx.staff.role === "OWNER") return children;

  return (
    <main id="main" className="mx-auto flex min-h-screen max-w-lg flex-col gap-4 p-4 pb-12 pt-8">
      <h1 className="font-display text-3xl font-bold text-primary">Almost ready</h1>
      <p className="text-muted-foreground">
        The owner of {displayStoreName(ctx.vendor)} is still setting up the store. Once they finish, sign in again
        and you can start.
      </p>
      <SignOutLink />
    </main>
  );
}
