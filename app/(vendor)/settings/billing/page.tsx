import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { BillingManageClient } from "@/components/billing/BillingManageClient";
import { SettingsPageHeader } from "@/components/settings/SettingsChrome";
import { PLAN_LIMITS } from "@/lib/constants";
import { formatIstDate } from "@/lib/datetime";
import { countBillableTxnThisMonth } from "@/lib/drops";
import { isPlanExpired, isPlanInGrace, planGraceEndsAt } from "@/lib/plan";
import { prisma } from "@/lib/prisma";
import { AuthError, requireVendorRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Plan & billing · Settings · AwaazOS" };

function formatDateDdMmYyyyIst(d: Date | null): string {
  return d ? formatIstDate(d) : "—";
}

export default async function BillingSettingsPage() {
  try {
    // `vendor.plan` is already the effective plan (lib/plan.ts); `storedPlan` is
    // the raw DB value, used only to explain an expiry.
    const { vendor, storedPlan } = await requireVendorRole("OWNER");
    const now = new Date();
    const storedPlanFields = { plan: storedPlan, planExpiresAt: vendor.planExpiresAt };
    const planExpired = isPlanExpired(storedPlanFields, now);
    const planInGrace = isPlanInGrace(storedPlanFields, now);
    const graceEndsAt = planGraceEndsAt(storedPlanFields);
    const [txnCount, settings] = await Promise.all([
      // Same count the plan cap enforces: unpaid storefront orders don't count.
      countBillableTxnThisMonth(prisma, vendor.id),
      prisma.vendorSettings.findUnique({ where: { vendorId: vendor.id } }),
    ]);

    const limits = PLAN_LIMITS[vendor.plan];
    const cap = limits.monthlyTxnCap;
    const usageLabel = cap === null ? `${txnCount} / Unlimited` : `${txnCount} / ${cap}`;

    return (
      <>
        <SettingsPageHeader title="Plan & billing" description="Manage your AwaazOS subscription." />
        <div className="space-y-4">
          <section className="rounded-lg border bg-card p-4 shadow-xs sm:p-6">
            <h2 className="font-medium">Current plan</h2>
            <p className="mt-2 text-2xl font-semibold">{limits.label}</p>
            {planExpired && vendor.planExpiresAt ? (
              <p className="mt-1 text-sm font-medium text-destructive">
                {PLAN_LIMITS[storedPlan].label} expired on {formatIstDate(vendor.planExpiresAt)} — you&apos;re
                now on {PLAN_LIMITS.FREE.label}.
              </p>
            ) : planInGrace && vendor.planExpiresAt && graceEndsAt ? (
              <p className="mt-1 text-sm font-medium text-destructive">
                Payment due — {PLAN_LIMITS[storedPlan].label} expired on {formatIstDate(vendor.planExpiresAt)}.
                Features stay on until {formatIstDate(graceEndsAt)}.
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">
                Renews / expires: {formatDateDdMmYyyyIst(vendor.planExpiresAt)}
              </p>
            )}
          </section>

          <section className="rounded-lg border bg-card p-4 shadow-xs sm:p-6">
            <h2 className="font-medium">Usage this month (IST)</h2>
            <p className="mt-2 text-lg font-semibold tabular-nums">{usageLabel} bills</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Monthly limit follows your plan. The counter uses the calendar month in Asia/Kolkata.
            </p>
          </section>

          <section className="rounded-lg border bg-card p-4 shadow-xs sm:p-6">
            <h2 className="font-medium">Invoices</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Prices are exclusive of 18% GST. Razorpay emails a receipt for every charge.
            </p>
          </section>

          <section className="rounded-lg border bg-card p-4 shadow-xs sm:p-6">
            <h2 className="mb-4 font-medium">Actions</h2>
            <BillingManageClient
              currentPlan={vendor.plan}
              hasRazorpaySubscription={Boolean(settings?.razorpaySubId)}
              cancelAtEnd={settings?.razorpaySubCancelAtEnd ?? false}
            />
          </section>
        </div>
      </>
    );
  } catch (e) {
    if (e instanceof AuthError) {
      // Billing is owner-only; other staff go back to the Settings overview.
      redirect(e.status === 403 ? "/settings" : "/sign-in");
    }
    throw e;
  }
}
