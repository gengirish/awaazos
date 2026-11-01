import { notFound } from "next/navigation";

import { AdminNav } from "@/components/admin/AdminNav";
import { EmptyState } from "@/components/ui/empty-state";
import {
  RECENT_REFERRALS_DAYS,
  RECENT_REFERRALS_LIMIT,
  TOP_REFERRERS_LIMIT,
  loadRecentReferrals,
  loadTopReferrers,
  referralRewardStatus,
  type RecentReferralRow,
} from "@/lib/admin-referrals";
import { formatIstDate } from "@/lib/datetime";
import { billingAccess } from "@/lib/plan";
import { AuthError, requirePlatformRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin referrals — AwaazOS" };

const BILLING_LABEL = { paid: "Paid", trial: "Trial", locked: "Locked", free: "Free" } as const;

function billingLabel(row: RecentReferralRow, now: Date): string {
  return BILLING_LABEL[billingAccess(row, now).kind];
}

const TH = "px-3 py-2 text-left text-xs font-medium text-muted-foreground";
const TH_NUM = "px-3 py-2 text-right text-xs font-medium text-muted-foreground";
const TD = "px-3 py-2 align-top";
const TD_NUM = "px-3 py-2 text-right align-top tabular-nums";

export default async function AdminReferralsPage() {
  // Same rule as /admin/vendors: role read from the database, and 404 rather
  // than 403 so the page does not disclose that it exists.
  try {
    await requirePlatformRole("SUPER_ADMIN");
  } catch (err) {
    if (err instanceof AuthError) notFound();
    throw err;
  }

  const now = new Date();
  const [top, recent] = await Promise.all([loadTopReferrers(), loadRecentReferrals(now)]);

  return (
    <div className="min-h-screen bg-background p-4 pb-10 md:p-6">
      <a href="#top-referrers" className="sr-only focus:not-sr-only">
        Skip to referrers
      </a>
      <header className="mx-auto mb-6 max-w-5xl">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Internal · Platform admin</p>
        <h1 className="mt-1 font-display text-3xl font-bold text-foreground">Referrals</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Stores that signed up through another store&apos;s invite link, and the free months their referrers
          earned. Demo stores are left out.
        </p>
        <AdminNav current="/admin/referrals" superAdmin />
      </header>

      <main id="main" className="mx-auto max-w-5xl space-y-10">
        <section id="top-referrers" aria-labelledby="top-referrers-heading">
          <h2 id="top-referrers-heading" className="mb-3 text-lg font-semibold text-foreground">
            Top referrers
          </h2>
          {top.length === 0 ? (
            <EmptyState title="No referrals yet" description="Stores appear here once someone signs up with their link." />
          ) : (
            <div className="overflow-x-auto rounded-lg border bg-card">
              <table className="w-full min-w-[40rem] text-sm">
                <caption className="sr-only">
                  Referrers sorted by reward months earned, then sign-ups
                </caption>
                <thead className="border-b">
                  <tr>
                    <th scope="col" className={TH}>
                      Store
                    </th>
                    <th scope="col" className={TH_NUM}>
                      Signed up
                    </th>
                    <th scope="col" className={TH_NUM}>
                      Earned a reward
                    </th>
                    <th scope="col" className={TH_NUM}>
                      Months earned
                    </th>
                    <th scope="col" className={TH_NUM}>
                      Redeemed
                    </th>
                    <th scope="col" className={TH_NUM}>
                      Banked
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {top.map((r) => (
                    <tr key={r.id} className="border-b last:border-b-0">
                      <th scope="row" className={`${TD} text-left font-normal`}>
                        <span className="block font-medium text-foreground">{r.name}</span>
                        <span className="block font-mono text-xs text-muted-foreground">/s/{r.slug}</span>
                      </th>
                      <td className={TD_NUM}>{r.signedUp.toLocaleString("en-IN")}</td>
                      <td className={TD_NUM}>{r.rewarded.toLocaleString("en-IN")}</td>
                      <td className={TD_NUM}>{r.monthsEarned.toLocaleString("en-IN")}</td>
                      <td className={TD_NUM}>{r.monthsRedeemed.toLocaleString("en-IN")}</td>
                      <td className={TD_NUM}>{r.monthsBanked.toLocaleString("en-IN")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {top.length === TOP_REFERRERS_LIMIT ? (
            <p className="mt-2 text-sm text-muted-foreground">Showing the top {TOP_REFERRERS_LIMIT} referrers.</p>
          ) : null}
        </section>

        <section aria-labelledby="recent-heading">
          <h2 id="recent-heading" className="mb-3 text-lg font-semibold text-foreground">
            Referred sign-ups, last {RECENT_REFERRALS_DAYS} days
          </h2>
          {recent.length === 0 ? (
            <EmptyState
              title="No referred sign-ups"
              description={`Nobody signed up through a referral link in the last ${RECENT_REFERRALS_DAYS} days.`}
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border bg-card">
              <table className="w-full min-w-[44rem] text-sm">
                <caption className="sr-only">Newest referred sign-ups first</caption>
                <thead className="border-b">
                  <tr>
                    <th scope="col" className={TH}>
                      Store
                    </th>
                    <th scope="col" className={TH}>
                      Referred by
                    </th>
                    <th scope="col" className={TH}>
                      Signed up
                    </th>
                    <th scope="col" className={TH}>
                      Billing
                    </th>
                    <th scope="col" className={TH}>
                      Reward
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((r) => (
                    <tr key={r.id} className="border-b last:border-b-0">
                      <th scope="row" className={`${TD} text-left font-normal`}>
                        <span className="block font-medium text-foreground">{r.name}</span>
                        <span className="block font-mono text-xs text-muted-foreground">/s/{r.slug}</span>
                      </th>
                      <td className={TD}>
                        {r.referredBy ? (
                          <>
                            <span className="block text-foreground">{r.referredBy.name}</span>
                            <span className="block font-mono text-xs text-muted-foreground">
                              /s/{r.referredBy.slug}
                            </span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">Deleted store</span>
                        )}
                      </td>
                      <td className={`${TD} tabular-nums`}>{formatIstDate(r.createdAt)}</td>
                      <td className={TD}>{billingLabel(r, now)}</td>
                      <td className={TD}>{referralRewardStatus(r.referralRewardFrom)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {recent.length === RECENT_REFERRALS_LIMIT ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Showing the newest {RECENT_REFERRALS_LIMIT} referred sign-ups.
            </p>
          ) : null}
        </section>
      </main>
    </div>
  );
}
