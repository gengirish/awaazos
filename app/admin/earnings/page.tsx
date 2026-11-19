import { notFound } from "next/navigation";

import { AdminNav } from "@/components/admin/AdminNav";
import { EmptyState } from "@/components/ui/empty-state";
import { formatINR } from "@/lib/currency";
import { formatIstDate } from "@/lib/datetime";
import { AuthError, requirePlatformRole } from "@/lib/rbac";
import { SALES_SHARE_BPS, SALES_SHARE_MONTHS } from "@/lib/sales-earnings";
import { loadSalesEarnings, type RepEarnings } from "@/lib/sales-earnings-server";
import { BRAND_NAME } from "@/lib/brand";

export const dynamic = "force-dynamic";
export const metadata = { title: `Sales earnings — ${BRAND_NAME}` };

/**
 * /admin/earnings — a SALES user sees their own share, a SUPER_ADMIN everyone's
 * (lib/sales-earnings.ts). An ADMIN, and anyone else, gets 404. A report: paying
 * out happens elsewhere and nothing here records it.
 */
export default async function SalesEarningsPage() {
  let isSales: boolean;
  let userId: string;
  try {
    const { user } = await requirePlatformRole("SALES");
    if (user.role === "ADMIN") notFound();
    isSales = user.role === "SALES";
    userId = user.id;
  } catch (err) {
    if (err instanceof AuthError) notFound();
    throw err;
  }

  const reps = await loadSalesEarnings(isSales ? userId : undefined);

  return (
    <div className="min-h-screen bg-background p-4 pb-10 md:p-6">
      <a href="#main" className="sr-only focus:not-sr-only">
        Skip to earnings
      </a>
      <header className="mx-auto mb-6 max-w-3xl">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Internal · Outreach</p>
        <h1 className="mt-1 font-display text-3xl font-bold text-foreground">Sales earnings</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {SALES_SHARE_BPS / 100}% of what each demo store pays once claimed, excluding GST, for {SALES_SHARE_MONTHS}{" "}
          months from its first charge. Figures are before any refunds and any tax deducted at payout.
        </p>
        <AdminNav current="/admin/earnings" superAdmin={!isSales} sales={isSales} />
      </header>

      <main id="main" className="mx-auto max-w-3xl space-y-6">
        {reps.length === 0 ? (
          <EmptyState
            title="No demo stores built yet"
            description="Earnings appear here once a store built from the pipeline is claimed and makes its first payment."
          />
        ) : (
          reps.map((rep) => <RepCard key={rep.userId} rep={rep} showWho={!isSales} />)
        )}
      </main>
    </div>
  );
}

function RepCard({ rep, showWho }: { rep: RepEarnings; showWho: boolean }) {
  const title = showWho ? rep.name || rep.email || "Removed account" : "Your earnings";
  return (
    <section aria-label={title} className="rounded-lg border bg-card p-4 shadow-xs sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate font-semibold text-foreground">{title}</h2>
          {showWho && rep.email ? <p className="truncate text-sm text-muted-foreground">{rep.email}</p> : null}
          <p className="text-sm text-muted-foreground">
            {rep.storesBuilt} built · {rep.stores.length} paying
          </p>
        </div>
        <p className="text-right">
          <span className="block text-xs text-muted-foreground">Total share</span>
          <span className="font-mono text-lg font-bold text-foreground">{formatINR(rep.totalSharePaise)}</span>
        </p>
      </div>

      {rep.months.length > 0 ? (
        <table className="mt-4 w-full text-sm">
          <caption className="sr-only">Share by month</caption>
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th scope="col" className="py-2 font-medium">
                Month
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Paid, excl. GST
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Share
              </th>
            </tr>
          </thead>
          <tbody>
            {rep.months.map((m) => (
              <tr key={m.key} className="border-b last:border-0">
                <th scope="row" className="py-2 text-left font-normal text-foreground">
                  {m.label}
                </th>
                <td className="py-2 text-right font-mono text-foreground">{formatINR(m.basePaise)}</td>
                <td className="py-2 text-right font-mono font-medium text-foreground">{formatINR(m.sharePaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {rep.stores.length > 0 ? (
        <ul className="mt-4 space-y-2 border-t pt-3">
          {rep.stores.map((s) => (
            <li key={s.vendorId} className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
              <span className="min-w-0 truncate font-medium text-foreground">{s.name}</span>
              <span className="text-xs text-muted-foreground">
                First paid {formatIstDate(s.firstChargeAt)}, share until {formatIstDate(s.shareEndsAt)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
