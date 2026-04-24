import { notFound } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAdminMetrics } from "@/lib/admin-metrics";
import { auth } from "@/lib/auth";
import { formatINR } from "@/lib/currency";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin metrics — AwaazOS" };

const IST_DATE_TIME_FORMAT = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

function formatDelta(delta: number): { label: string; tone: "pos" | "neg" | "zero" } {
  const pct = delta * 100;
  if (Math.abs(pct) < 0.05) {
    return { label: "0.0%", tone: "zero" };
  }
  const sign = pct > 0 ? "+" : "";
  return {
    label: `${sign}${pct.toFixed(1)}%`,
    tone: pct > 0 ? "pos" : "neg",
  };
}

function deltaClass(tone: "pos" | "neg" | "zero"): string {
  if (tone === "pos") return "text-emerald-600";
  if (tone === "neg") return "text-rose-600";
  return "text-slate-500";
}

export default async function AdminMetricsPage() {
  const session = await auth();
  const role = session?.user?.role;
  if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
    notFound();
  }

  const metrics = await getAdminMetrics();

  const voicePctLabel = `${(metrics.voiceSuccessRate7d * 100).toFixed(1)}%`;
  const activeWow = formatDelta(metrics.wowGrowth.activeVendorsWoW);
  const gmvWow = formatDelta(metrics.wowGrowth.gmvWoW);
  const generatedAt = IST_DATE_TIME_FORMAT.format(metrics.windows.now);

  return (
    <div className="min-h-screen bg-background p-4 pb-10 md:p-6">
      <header className="mx-auto mb-8 max-w-5xl">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Internal · YC dashboard
        </p>
        <h1 className="mt-1 font-display text-3xl font-bold text-foreground">
          AwaazOS — weekly health
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Rolling 7-day windows, IST midnights · Generated {generatedAt}
        </p>
      </header>

      <main className="mx-auto grid max-w-5xl grid-cols-1 gap-4 md:grid-cols-6">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Weekly active vendors
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-bold tabular-nums text-foreground">
              {metrics.weeklyActiveVendors.toLocaleString("en-IN")}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Distinct vendors with ≥1 paid bill in the last 7 days
            </p>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Bills / vendor / day
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-bold tabular-nums text-foreground">
              {metrics.billsPerVendorPerDayMedian.toFixed(1)}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Median across active vendors (7d total ÷ 7)
            </p>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Voice success rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-bold tabular-nums text-foreground">{voicePctLabel}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              Paid bills with source = VOICE ÷ all paid bills (7d)
            </p>
          </CardContent>
        </Card>

        <Card className="md:col-span-3">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Weekly GMV
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-bold tabular-nums text-foreground">
              {formatINR(metrics.weeklyGmvPaise)}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Sum of <code>totalPaise</code> across paid bills in the last 7 days
            </p>
          </CardContent>
        </Card>

        <Card className="md:col-span-3">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Week-over-week growth
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4">
              <div>
                <dt className="text-xs text-muted-foreground">Active vendors</dt>
                <dd
                  className={`mt-1 text-3xl font-bold tabular-nums ${deltaClass(activeWow.tone)}`}
                >
                  {activeWow.label}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">GMV</dt>
                <dd
                  className={`mt-1 text-3xl font-bold tabular-nums ${deltaClass(gmvWow.tone)}`}
                >
                  {gmvWow.label}
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">
              vs. the prior 7-day window [now − 14d, now − 7d)
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
