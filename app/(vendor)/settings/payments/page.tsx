import type { Metadata } from "next";

import { PaymentMethodsClient } from "@/components/settings/PaymentMethodsClient";
import { RazorpayKeysClient } from "@/components/settings/RazorpayKeysClient";
import { SettingsCard, SettingsPageHeader } from "@/components/settings/SettingsChrome";
import { PLAN_LIMITS } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { isRazorpayOauthConfigured, publicTokenMode } from "@/lib/razorpay-oauth";
import { isSecretBoxConfigured } from "@/lib/secret-box";
import {
  hasLiveOauthConnection,
  hasOauthConnection,
  hasStoredRazorpayKeys,
  RAZORPAY_CRED_SELECT,
  vendorWebhookUrl,
} from "@/lib/storefront-razorpay";

import { requireSettingsContext } from "../_context";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Payments · Settings · AwaazOS" };

/** Outcome codes the Connect Razorpay callback redirects back with. */
const OUTCOME_RE = /^[a-z_]{1,24}$/;

export default async function PaymentsSettingsPage(props: { searchParams: Promise<{ razorpay?: string | string[] }> }) {
  const { vendor, isOwner } = await requireSettingsContext();
  const rawOutcome = (await props.searchParams).razorpay;
  const outcome = typeof rawOutcome === "string" && OUTCOME_RE.test(rawOutcome) ? rawOutcome : null;

  const settings = await prisma.vendorSettings.findUnique({
    where: { vendorId: vendor.id },
    select: {
      acceptPayOnDelivery: true,
      // Presence only — the encrypted secrets and tokens never leave this server component.
      ...RAZORPAY_CRED_SELECT,
    },
  });

  const oauth = hasOauthConnection(settings);
  const keys = hasStoredRazorpayKeys(settings);
  const method = oauth ? "oauth" : keys ? "keys" : null;
  const razorpayKeyIdLast4 = method === "keys" && settings?.razorpayKeyId ? settings.razorpayKeyId.slice(-4) : null;

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
            initialMethod={method}
            initialKeyIdLast4={razorpayKeyIdLast4}
            accountId={oauth ? settings?.razorpayAccountId ?? null : null}
            oauthMode={oauth && settings?.razorpayPublicToken ? publicTokenMode(settings.razorpayPublicToken) : null}
            needsReconnect={oauth && !hasLiveOauthConnection(settings)}
            oauthAvailable={isRazorpayOauthConfigured()}
            outcome={outcome}
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
