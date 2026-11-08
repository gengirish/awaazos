import { notFound } from "next/navigation";

import { AdminNav } from "@/components/admin/AdminNav";
import { PricingCalculator } from "@/components/admin/PricingCalculator";
import { AuthError, requirePlatformRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin pricing calculator — AwaazOS" };

/**
 * Pricing calculator (lib/pricing-calculator.ts) for any platform ADMIN: what a
 * kitchen pays on each pricing model vs its gateway and a delivery app. Runs
 * entirely in the browser; reads nothing beyond the role check.
 */
export default async function AdminPricingPage() {
  let superAdmin: boolean;
  try {
    const { user } = await requirePlatformRole("ADMIN");
    superAdmin = user.role === "SUPER_ADMIN";
  } catch (err) {
    // 404, not 403 — never disclose that this admin surface exists.
    if (err instanceof AuthError) notFound();
    throw err;
  }

  return (
    <div className="min-h-screen bg-background p-4 pb-10 md:p-6">
      <a href="#main" className="sr-only focus:not-sr-only">
        Skip to the calculator
      </a>
      <header className="mx-auto mb-6 max-w-5xl">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Internal · Platform admin</p>
        <h1 className="mt-1 font-display text-3xl font-bold text-foreground">Pricing calculator</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          What a kitchen pays each month on each plan, what its gateway and a delivery app would take, and what AwaazOS
          earns. Estimates for planning and sales calls — nothing here changes a price.
        </p>
        <AdminNav current="/admin/pricing" superAdmin={superAdmin} />
      </header>

      <main id="main" className="mx-auto max-w-5xl">
        <PricingCalculator />
      </main>
    </div>
  );
}
