import Link from "next/link";
import { redirect } from "next/navigation";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StorefrontClient } from "@/components/settings/StorefrontClient";
import { VoiceLanguageClient } from "@/components/settings/VoiceLanguageClient";
import { prisma } from "@/lib/prisma";
import { AuthError, requireVendorRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  let vendorId: string;
  try {
    const ctx = await requireVendorRole("CASHIER");
    vendorId = ctx.vendor.id;
  } catch (e) {
    if (e instanceof AuthError) {
      redirect("/sign-in");
    }
    throw e;
  }

  const [settings, vendor, availableItemCount] = await Promise.all([
    prisma.vendorSettings.findUnique({
      where: { vendorId },
      select: { voiceLang: true, publishStorefront: true },
    }),
    prisma.vendor.findUnique({
      where: { id: vendorId },
      select: { slug: true, upiId: true },
    }),
    prisma.menuItem.count({ where: { vendorId, isAvailable: true } }),
  ]);

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

        <Card className="h-full sm:col-span-2">
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
