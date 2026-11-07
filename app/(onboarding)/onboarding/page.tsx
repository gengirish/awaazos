import { PLAN_LIMITS } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { CONNECT_OUTCOME_RE } from "@/lib/razorpay-connect";
import { isRazorpayOauthConfigured } from "@/lib/razorpay-oauth";
import { requireVendorRole } from "@/lib/rbac";
import { isSecretBoxConfigured } from "@/lib/secret-box";
import { isOnlinePaymentEnabled, RAZORPAY_CRED_SELECT } from "@/lib/storefront-razorpay";

import { OnboardingForm } from "./OnboardingForm";

export const dynamic = "force-dynamic";

/**
 * Server half of setup: what only the server knows about Razorpay, for step 2.
 * The layout has already let only an unfinished store's OWNER through. The
 * encrypted credentials are read for presence only and never reach the form.
 */
export default async function OnboardingPage(props: { searchParams: Promise<{ razorpay?: string | string[] }> }) {
  const { vendor } = await requireVendorRole("OWNER");
  const rawOutcome = (await props.searchParams).razorpay;
  const outcome = typeof rawOutcome === "string" && CONNECT_OUTCOME_RE.test(rawOutcome) ? rawOutcome : null;

  const settings = await prisma.vendorSettings.findUnique({
    where: { vendorId: vendor.id },
    select: RAZORPAY_CRED_SELECT,
  });

  return (
    <OnboardingForm
      razorpay={{
        connected: isOnlinePaymentEnabled(vendor, settings),
        canConnect:
          isRazorpayOauthConfigured() && isSecretBoxConfigured() && PLAN_LIMITS[vendor.plan].razorpayLinks,
        outcome,
      }}
    />
  );
}
