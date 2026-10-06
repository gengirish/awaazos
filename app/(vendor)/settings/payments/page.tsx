import type { Metadata } from "next";

import { PaymentMethodsClient } from "@/components/settings/PaymentMethodsClient";
import { RazorpayKeysClient } from "@/components/settings/RazorpayKeysClient";
import { SettingsCard, SettingsPageHeader } from "@/components/settings/SettingsChrome";
import { PLAN_LIMITS } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { isSecretBoxConfigured } from "@/lib/secret-box";
import { hasStoredRazorpayCreds, vendorWebhookUrl } from "@/lib/storefront-razorpay";

import { requireSettingsContext } from "../_context";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Payments · Settings · AwaazOS" };

export default async function PaymentsSettingsPage() {
  const { vendor, isOwner } = await requireSettingsContext();

  const settings = await prisma.vendorSettings.findUnique({
    where: { vendorId: vendor.id },
    select: {
      acceptPayOnDelivery: true,
      // Presence only — the encrypted secrets never leave this server component.
      razorpayKeyId: true,
      razorpayKeySecretEnc: true,
      razorpayWebhookSecretEnc: true,
    },
  });

  const razorpayConfigured = hasStoredRazorpayCreds(settings);
  const razorpayKeyIdLast4 = razorpayConfigured && settings?.razorpayKeyId ? settings.razorpayKeyId.slice(-4) : null;

  return (
    <>
      <SettingsPageHeader title="Payments" description="How customers pay you for online orders and Drops." />
      <div className="space-y-4">
        <PaymentMethodsClient
          initialUpiId={vendor.upiId}
          initialUpiName={vendor.upiName}
          initialAcceptPayOnDelivery={settings?.acceptPayOnDelivery ?? true}
          isOwner={isOwner}
        />
        <SettingsCard
          title="Online payments (Razorpay)"
          description="Let customers pay online for pre-orders, into your own Razorpay account."
        >
          <RazorpayKeysClient
            initialConfigured={razorpayConfigured}
            initialKeyIdLast4={razorpayKeyIdLast4}
            webhookUrl={isOwner ? vendorWebhookUrl(vendor.id) : ""}
            planEligible={PLAN_LIMITS[vendor.plan].razorpayLinks}
            encryptionConfigured={isSecretBoxConfigured()}
            isOwner={isOwner}
          />
        </SettingsCard>
      </div>
    </>
  );
}
