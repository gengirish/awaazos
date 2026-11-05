import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { lockReason } from "@/components/billing/BillingLockedCard";
import { BillingManageClient } from "@/components/billing/BillingManageClient";
import { SettingsPageHeader } from "@/components/settings/SettingsChrome";
import { PLAN_LIMITS, PLAN_RANK, TRIAL_DAYS } from "@/lib/constants";
import { formatIstDate } from "@/lib/datetime";
import { countBillableTxnThisMonth } from "@/lib/drops";
import { isPlanExpired, isPlanInGrace, planGraceEndsAt, trialDaysLeft } from "@/lib/plan";
import { prisma } from "@/lib/prisma";
import { AuthError, requireVendorRole } from "@/lib/rbac";
import { canPromoteReferrals, referralPitch } from "@/lib/referral";
import { LIVE_SUBSCRIPTION_STATUSES, SUBSCRIBABLE_PLANS, type SubscribablePlan } from "@/lib/subscription";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Plan & billing · Settings · AwaazOS" };

function formatDateDdMmYyyyIst(d: Date | null): string {
  return d ? formatIstDate(d) : "—";
}

export default async function BillingSettingsPage() {
  try {
    // `vendor.plan` is already the effective plan (lib/plan.ts); `storedPlan` is
    // the raw DB value, used only to explain an expiry.
    const { vendor, storedPlan, access, user } = await requireVendorRole("OWNER");
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
    // More than TRIAL_DAYS left means free access granted on /admin/vendors.
    const trialLeft = access.kind === "trial" ? trialDaysLeft(access.endsAt, now) : 0;
    const hasLiveSubscription = LIVE_SUBSCRIPTION_STATUSES.includes(settings?.razorpaySubStatus ?? "");
    // A store's own price is for Starter alone. Paying: only a step up, which
    // replaces the subscription. Otherwise anything, unless one is already live.
    const sellable: readonly SubscribablePlan[] = vendor.customPricePaise === null ? SUBSCRIBABLE_PLANS : ["STARTER"];
    const plansOnOffer =
      access.kind === "paid"
        ? sellable.filter((plan) => PLAN_RANK[plan] > PLAN_RANK[access.plan])
        : hasLiveSubscription
          ? []
          : sellable;

    return (
      <>
        <SettingsPageHeader title="Plan & billing" description="Manage your AwaazOS subscription." />
        <div className="space-y-4">
          <section className="rounded-lg border bg-card p-4 shadow-xs sm:p-6">
            <h2 className="font-medium">Current plan</h2>
            <p className="mt-2 text-2xl font-semibold">
              {access.kind === "trial"
                ? `${limits.label} — free trial`
                : access.kind === "locked"
                  ? "No active plan"
                  : limits.label}
            </p>
            {access.kind === "trial" ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {trialLeft > TRIAL_DAYS ? trialLeft : `${trialLeft} of ${TRIAL_DAYS}`} days left — ends on{" "}
                {formatIstDate(access.endsAt)}.{" "}
                {hasLiveSubscription
                  ? "Your subscription starts when the trial ends."
                  : "Subscribe any time; you won't be charged until the trial ends."}
              </p>
            ) : access.kind === "locked" ? (
              <p className="mt-1 text-sm font-medium text-destructive">
                {lockReason(access.since, vendor.trialEndsAt) === "trial"
                  ? `Your ${TRIAL_DAYS}-day free trial`
                  : "Your paid plan"}{" "}
                ended on {formatIstDate(access.since)}. New bills and online orders
                are paused until you subscribe. Your records are still here.
              </p>
            ) : planExpired && vendor.planExpiresAt ? (
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

          {canPromoteReferrals({ role: "OWNER", isDemo: vendor.isDemo, access, hasLiveSubscription }) ? (
            <section className="rounded-lg border bg-card p-4 shadow-xs sm:p-6">
              <h2 className="font-medium">Earn free months</h2>
              <p className="mt-2 text-sm text-muted-foreground">{referralPitch()}</p>
              <Link
                href="/settings/refer"
                className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-primary underline underline-offset-2"
              >
                Invite a seller
              </Link>
            </section>
          ) : null}

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
              plans={plansOnOffer}
              isUpgrade={access.kind === "paid"}
              // Live, or a subscription from before the status column existed.
              canCancel={
                hasLiveSubscription || Boolean(settings?.razorpaySubId && !settings.razorpaySubStatus)
              }
              cancelAtEnd={settings?.razorpaySubCancelAtEnd ?? false}
              prefillName={user.name}
              prefillEmail={user.email}
              customPricePaise={vendor.customPricePaise}
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
