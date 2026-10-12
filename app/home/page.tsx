import { redirect } from "next/navigation";

import { resolveHomePath } from "@/lib/home";
import { prisma } from "@/lib/prisma";
import { AuthError, requireVendorRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata = { title: "AwaazOS", robots: { index: false, follow: false } };

/**
 * The signed-in landing resolver (lib/home.ts): renders nothing, only
 * redirects. Sign-in, sign-up, the end of onboarding and the installed app's
 * `start_url` all come here.
 *
 * Deliberately outside the `(vendor)` route group: that group streams behind a
 * loading boundary, which would turn this into a 200 with a client-side
 * redirect. Here there is nothing to stream, so a document request gets a real
 * 307 — which is what the Home Screen icon and the service worker want.
 *
 * It grants nothing. Middleware has already required a session to reach it,
 * `requireVendorRole` checks membership again, and the page it redirects to
 * authorises itself.
 */
export default async function HomePage() {
  let destination: string;
  try {
    const ctx = await requireVendorRole("CASHIER");
    const settings = await prisma.vendorSettings.findUnique({
      where: { vendorId: ctx.vendor.id },
      select: { publishStorefront: true },
    });
    destination = resolveHomePath({
      onboardingDone: ctx.vendor.onboardingDone,
      publishStorefront: settings?.publishStorefront,
    });
  } catch (e) {
    if (!(e instanceof AuthError)) throw e;
    destination = "/sign-in";
  }
  redirect(destination);
}
