import { redirect } from "next/navigation";

import { BillingManageClient } from "@/components/billing/BillingManageClient";
import { PLAN_LIMITS } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { AuthError, requireVendorRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";

function startOfCalendarMonthKolkata(): Date {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  return new Date(`${y}-${m}-01T00:00:00+05:30`);
}

function formatDateDdMmYyyyIst(d: Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

export default async function BillingSettingsPage() {
  try {
    const { vendor } = await requireVendorRole("OWNER");
    const monthStart = startOfCalendarMonthKolkata();
    const [txnCount, settings] = await Promise.all([
      prisma.transaction.count({
        where: { vendorId: vendor.id, createdAt: { gte: monthStart } },
      }),
      prisma.vendorSettings.findUnique({ where: { vendorId: vendor.id } }),
    ]);

    const limits = PLAN_LIMITS[vendor.plan];
    const cap = limits.monthlyTxnCap;
    const usageLabel = cap === null ? `${txnCount} / Unlimited` : `${txnCount} / ${cap}`;

    return (
      <div className="min-h-screen bg-background p-4 pb-10 md:p-6">
        <div className="mx-auto max-w-2xl space-y-8">
          <header>
            <h1 className="font-display text-2xl font-semibold">Billing</h1>
            <p className="text-sm text-muted-foreground">Manage your AwaazOS subscription.</p>
          </header>

          <section className="rounded-lg border bg-card p-6 shadow-sm">
            <h2 className="font-medium">Current plan</h2>
            <p className="mt-2 text-2xl font-semibold">{limits.label}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Renews / expires: {formatDateDdMmYyyyIst(vendor.planExpiresAt)}
            </p>
          </section>

          <section className="rounded-lg border bg-card p-6 shadow-sm">
            <h2 className="font-medium">Usage this month (IST)</h2>
            <p className="mt-2 text-lg font-semibold tabular-nums">{usageLabel} bills</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Monthly limit follows your plan. The counter uses the calendar month in Asia/Kolkata.
            </p>
          </section>

          <section className="rounded-lg border bg-card p-6 shadow-sm">
            <h2 className="font-medium">Invoices</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Invoice PDFs and history live in your Razorpay merchant dashboard for the linked account.
            </p>
          </section>

          <section className="rounded-lg border bg-card p-6 shadow-sm">
            <h2 className="mb-4 font-medium">Actions</h2>
            <BillingManageClient
              currentPlan={vendor.plan}
              hasRazorpaySubscription={Boolean(settings?.razorpaySubId)}
            />
          </section>
        </div>
      </div>
    );
  } catch (e) {
    if (e instanceof AuthError) {
      redirect("/sign-in");
    }
    throw e;
  }
}
