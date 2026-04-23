import Link from "next/link";
import { redirect } from "next/navigation";

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AuthError, requireVendorRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  try {
    await requireVendorRole("CASHIER");
  } catch (e) {
    if (e instanceof AuthError) {
      redirect("/sign-in");
    }
    throw e;
  }

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
        <Link href="/settings/billing" className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Card className="h-full transition-colors hover:bg-muted/40">
            <CardHeader>
              <CardTitle className="font-display text-lg">Billing</CardTitle>
              <CardDescription>Plan, usage, and invoices.</CardDescription>
            </CardHeader>
          </Card>
        </Link>
        <Card className="h-full border-dashed opacity-80">
          <CardHeader>
            <CardTitle className="font-display text-lg">Vendor profile</CardTitle>
            <CardDescription>Coming soon — stall details and branding.</CardDescription>
          </CardHeader>
        </Card>
      </main>
    </div>
  );
}
