import { notFound } from "next/navigation";

import { ActivationFunnelTable } from "@/components/admin/ActivationFunnelTable";
import { AdminNav } from "@/components/admin/AdminNav";
import { BetBoard } from "@/components/admin/BetBoard";
import { GtmTimeline } from "@/components/admin/GtmTimeline";
import { istYmd, metricSnapshot, toBetOutput } from "@/lib/admin-bets";
import { loadActivation, loadBets, loadTimeline } from "@/lib/admin-bets-server";
import { getAdminMetrics } from "@/lib/admin-metrics";
import { loadOrderFunnel } from "@/lib/order-funnel-server";
import { AuthError, requirePlatformRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const metadata = { title: "Bets and timeline — AwaazOS" };

const IST_DATE_TIME_FORMAT = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

/**
 * /admin/bets (docs/admin-redesign/PHASE-4.md): the Bet Board, the GTM timeline
 * and activation by city. Platform ADMIN, like /admin/metrics; everything is read
 * on render, nothing on a timer.
 */
export default async function AdminBetsPage() {
  let superAdmin = false;
  try {
    const { user } = await requirePlatformRole("ADMIN");
    superAdmin = user.role === "SUPER_ADMIN";
  } catch (err) {
    // 404, not 403 — never disclose that this admin surface exists.
    if (err instanceof AuthError) notFound();
    throw err;
  }

  const now = new Date();
  // The bet metrics are the same numbers /admin/metrics shows for the same 7 days.
  const [bets, metrics, funnel, timeline, activation] = await Promise.all([
    loadBets(),
    getAdminMetrics(now),
    loadOrderFunnel(now, { withContacts: false }),
    loadTimeline(now),
    loadActivation(),
  ]);

  return (
    <div className="min-h-screen bg-background p-4 pb-10 md:p-6">
      <a href="#main" className="sr-only focus:not-sr-only">
        Skip to bets
      </a>
      <header className="mx-auto mb-6 max-w-5xl">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Internal · Admin</p>
        <h1 className="mt-1 font-display text-3xl font-bold text-foreground">Bets and timeline</h1>
        <p className="mt-2 text-sm text-muted-foreground">Generated {IST_DATE_TIME_FORMAT.format(now)}</p>
        <AdminNav current="/admin/bets" superAdmin={superAdmin} />
      </header>

      <main id="main" className="mx-auto max-w-5xl space-y-10">
        <BetBoard bets={bets.map(toBetOutput)} snapshot={metricSnapshot(metrics, funnel)} now={now} />
        <GtmTimeline timeline={timeline} todayYmd={istYmd(now)} />
        <ActivationFunnelTable funnel={activation} />
      </main>
    </div>
  );
}
