import { notFound } from "next/navigation";

import { AdminNav } from "@/components/admin/AdminNav";
import { TrackingTripwireBanner } from "@/components/admin/TrackingTripwireBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type MetricChange, describeChange } from "@/lib/admin-metric-change";
import { getAdminMetrics } from "@/lib/admin-metrics";
import { ADMIN_METRICS_CONFIG } from "@/lib/admin-metrics-config";
import type { TripwireResult } from "@/lib/admin-tripwires";
import { formatINR } from "@/lib/currency";
import { formatIstDate } from "@/lib/datetime";
import { AuthError, requirePlatformRole } from "@/lib/rbac";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin metrics — AwaazOS" };

const IST_DATE_TIME_FORMAT = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

const ONE_DECIMAL = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const MS_PER_DAY = 86_400_000;

function toneClass(change: MetricChange): string {
  if (change.tone === "up") return "text-success";
  if (change.tone === "down") return "text-destructive";
  return "text-muted-foreground";
}

/** "+3 sellers · small base" under a card's number, vs the previous 7 days. */
function ChangeLine({ change }: { change: MetricChange }) {
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <span className={cn("font-semibold tabular-nums", toneClass(change))}>{change.label}</span>
      <span className="text-muted-foreground">vs previous 7 days</span>
      {change.smallBase ? (
        <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">small base</span>
      ) : null}
    </p>
  );
}

function checkLabel(check: TripwireResult): string {
  if (check.status === "fired") return "Fired";
  if (check.status === "clear") return "OK";
  return `Waiting: ${check.trackedDays} of ${check.requiredDays} tracked days`;
}

export default async function AdminMetricsPage() {
  let canManageStores = false;
  // Re-read the User row rather than trusting `session.user.role` off the JWT, so a
  // role revoked in the database takes effect immediately instead of at token expiry.
  try {
    canManageStores = (await requirePlatformRole("ADMIN")).user.role === "SUPER_ADMIN";
  } catch (err) {
    // 404, not 403 — never disclose that this admin surface exists.
    if (err instanceof AuthError) notFound();
    throw err;
  }

  const now = new Date();
  const metrics = await getAdminMetrics(now);

  const { smallBase } = ADMIN_METRICS_CONFIG;
  const sellersChange = describeChange(
    metrics.activeSellers.current,
    metrics.activeSellers.prior,
    smallBase.activeSellers,
    { kind: "count", singular: "seller", plural: "sellers" },
  );
  const gmvChange = describeChange(metrics.gmvPaise.current, metrics.gmvPaise.prior, smallBase.gmvPaise, {
    kind: "paise",
  });
  const voicePctLabel = `${ONE_DECIMAL.format(metrics.voiceShare.share * 100)}%`;
  const windowLabel = `${formatIstDate(metrics.windows.thisWeekStart)} to ${formatIstDate(
    new Date(metrics.windows.todayStart.getTime() - MS_PER_DAY),
  )}`;
  const untrackedOrders = metrics.instagram.storefrontOrders - metrics.instagram.storefrontOrdersSince;
  const fired = metrics.tripwires.filter((t) => t.status === "fired");
  const generatedAt = IST_DATE_TIME_FORMAT.format(metrics.windows.now);

  return (
    <div className="min-h-screen bg-background p-4 pb-10 md:p-6">
      <a href="#main" className="sr-only focus:not-sr-only">
        Skip to metrics
      </a>
      <header className="mx-auto mb-6 max-w-5xl">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Internal · Admin</p>
        <h1 className="mt-1 font-display text-3xl font-bold text-foreground">AwaazOS — weekly health</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Last 7 complete days in IST, {windowLabel} · Generated {generatedAt}
        </p>
        <AdminNav current="/admin/metrics" superAdmin={canManageStores} />
      </header>

      <main id="main" className="mx-auto max-w-5xl space-y-4">
        {fired.length > 0 ? (
          <div className="space-y-3">
            {fired.map((t) => (
              <TrackingTripwireBanner key={t.id} id={t.id} title={t.title} explanation={t.explanation} />
            ))}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-6">
          <Card className="md:col-span-3">
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">Active sellers</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-4xl font-bold tabular-nums text-foreground">
                {metrics.activeSellers.current.toLocaleString("en-IN")}
              </p>
              <ChangeLine change={sellersChange} />
              <p className="mt-2 text-xs text-muted-foreground">Sellers with at least 1 paid bill in the 7 days</p>
            </CardContent>
          </Card>

          <Card className="md:col-span-3">
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">Sales (GMV)</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-4xl font-bold tabular-nums text-foreground">{formatINR(metrics.gmvPaise.current)}</p>
              <ChangeLine change={gmvChange} />
              <p className="mt-2 text-xs text-muted-foreground">Sum of paid bills&apos; totals in the 7 days</p>
            </CardContent>
          </Card>

          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">Bills / seller / day</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-4xl font-bold tabular-nums text-foreground">
                {ONE_DECIMAL.format(metrics.billsPerSellerPerDayMedian)}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Median across active sellers of paid bills ÷ 7
              </p>
            </CardContent>
          </Card>

          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">Voice share</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-4xl font-bold tabular-nums text-foreground">{voicePctLabel}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {metrics.voiceShare.voiceBills.toLocaleString("en-IN")} of{" "}
                {metrics.voiceShare.paidBills.toLocaleString("en-IN")} paid bills were rung up by voice. Storefront
                orders count in the total but are never voice.
              </p>
            </CardContent>
          </Card>

          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">Today so far</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-4xl font-bold tabular-nums text-foreground">{formatINR(metrics.today.gmvPaise)}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {metrics.today.paidBills.toLocaleString("en-IN")} paid bills since midnight IST, not in the 7 days
              </p>
            </CardContent>
          </Card>

          <Card className="md:col-span-3">
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">Orders from Instagram</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-4xl font-bold tabular-nums text-foreground">{metrics.instagram.orders}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                Of {metrics.instagram.storefrontOrdersSince} storefront orders placed since{" "}
                {formatIstDate(metrics.instagram.since)}; {metrics.instagram.paid} paid. Counted when placed in
                Instagram&apos;s browser or from a <code>?src=ig</code> link.
                {untrackedOrders > 0
                  ? ` ${untrackedOrders} of the ${metrics.instagram.storefrontOrders} storefront orders in the 7 days came before tracking started and can't be counted.`
                  : ""}
              </p>
            </CardContent>
          </Card>

          <section aria-labelledby="checks-heading" className="rounded-lg border bg-card p-4 md:col-span-3">
            <h2 id="checks-heading" className="text-sm font-semibold text-foreground">
              Tracking checks
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              A check fires when a number sits at exactly 0 for {ADMIN_METRICS_CONFIG.tripwireDays} tracked days while
              the number that feeds it is above 0.
            </p>
            <ul className="mt-3 divide-y text-sm">
              {metrics.tripwires.map((t) => (
                <li key={t.id} className="flex flex-wrap justify-between gap-2 py-2">
                  <span className="text-foreground">{t.title}</span>
                  <span
                    className={cn(
                      "font-medium",
                      t.status === "fired" ? "text-warning" : t.status === "clear" ? "text-success" : "text-muted-foreground",
                    )}
                  >
                    {checkLabel(t)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </main>
    </div>
  );
}
