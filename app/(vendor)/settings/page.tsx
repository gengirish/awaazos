import Link from "next/link";
import { redirect } from "next/navigation";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HomeKitchenClient } from "@/components/settings/HomeKitchenClient";
import { RazorpayKeysClient } from "@/components/settings/RazorpayKeysClient";
import { StorefrontClient } from "@/components/settings/StorefrontClient";
import { VoiceLanguageClient } from "@/components/settings/VoiceLanguageClient";
import { PLAN_LIMITS } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { AuthError, requireVendorRole } from "@/lib/rbac";
import { isSecretBoxConfigured } from "@/lib/secret-box";
import { hasStoredRazorpayCreds, vendorWebhookUrl } from "@/lib/storefront-razorpay";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  let vendorId: string;
  let vendorPlan: keyof typeof PLAN_LIMITS;
  let isOwner: boolean;
  try {
    const ctx = await requireVendorRole("CASHIER");
    vendorId = ctx.vendor.id;
    vendorPlan = ctx.vendor.plan;
    isOwner = ctx.staff.role === "OWNER";
  } catch (e) {
    if (e instanceof AuthError) {
      redirect("/sign-in");
    }
    throw e;
  }

  const [settings, vendor, availableItemCount] = await Promise.all([
    prisma.vendorSettings.findUnique({
      where: { vendorId },
      select: {
        voiceLang: true,
        publishStorefront: true,
        fssaiNumber: true,
        acceptPayOnDelivery: true,
        // Presence only — the encrypted secrets never leave this server component.
        razorpayKeyId: true,
        razorpayKeySecretEnc: true,
        razorpayWebhookSecretEnc: true,
      },
    }),
    prisma.vendor.findUnique({
      where: { id: vendorId },
      select: { slug: true, upiId: true },
    }),
    prisma.menuItem.count({ where: { vendorId, isAvailable: true } }),
  ]);

  const razorpayConfigured = hasStoredRazorpayCreds(settings);
  const razorpayKeyIdLast4 = razorpayConfigured && settings?.razorpayKeyId ? settings.razorpayKeyId.slice(-4) : null;

  return (
    <div className="min-h-screen bg-background p-4 pb-10 md:p-6">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Skip to main content
      </a>
      <header className="mx-auto mb-6 max-w-3xl">
        <h1 className="font-display text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your stall and subscription.</p>
      </header>

      <main id="main" className="mx-auto grid max-w-3xl gap-4 sm:grid-cols-2">
        <Link
          href="/settings/billing"
          className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Card className="h-full transition-colors hover:bg-muted/40">
            <CardHeader>
              <CardTitle className="font-display text-lg">Billing</CardTitle>
              <CardDescription>Plan, usage, and invoices.</CardDescription>
            </CardHeader>
          </Card>
        </Link>

        <Card id="storefront" className="h-full sm:col-span-2">
          <CardHeader>
            <CardTitle className="font-display text-lg">Public storefront</CardTitle>
            <CardDescription>
              Share your menu as a web page customers can open from a QR or a WhatsApp link.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <StorefrontClient
              slug={vendor?.slug ?? ""}
              initialPublished={settings?.publishStorefront ?? false}
              hasUpiId={Boolean(vendor?.upiId)}
              availableItemCount={availableItemCount}
            />
          </CardContent>
        </Card>

        <Card id="pre-orders" className="h-full sm:col-span-2">
          <CardHeader>
            <CardTitle className="font-display text-lg">Pre-orders (Drops)</CardTitle>
            <CardDescription>
              How customers pay for pre-orders, and the food licence shown on your storefront.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <HomeKitchenClient
              initialFssaiNumber={settings?.fssaiNumber ?? null}
              initialAcceptPayOnDelivery={settings?.acceptPayOnDelivery ?? true}
              hasUpiId={Boolean(vendor?.upiId)}
            />
          </CardContent>
        </Card>

        <Card id="online-payments" className="h-full sm:col-span-2">
          <CardHeader>
            <CardTitle className="font-display text-lg">Online payments (Razorpay)</CardTitle>
            <CardDescription>
              Let customers pay online for pre-orders, into your own Razorpay account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RazorpayKeysClient
              initialConfigured={razorpayConfigured}
              initialKeyIdLast4={razorpayKeyIdLast4}
              webhookUrl={isOwner ? vendorWebhookUrl(vendorId) : ""}
              planEligible={PLAN_LIMITS[vendorPlan].razorpayLinks}
              encryptionConfigured={isSecretBoxConfigured()}
              isOwner={isOwner}
            />
          </CardContent>
        </Card>

        <Card className="h-full sm:col-span-2">
          <CardHeader>
            <CardTitle className="font-display text-lg">Voice & language</CardTitle>
            <CardDescription>
              Pick the language your counter staff will speak when using the POS mic.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <VoiceLanguageClient initialVoiceLang={settings?.voiceLang ?? "en-IN"} />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
