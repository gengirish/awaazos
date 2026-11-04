import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminNav } from "@/components/admin/AdminNav";
import { StoreSurveySummary } from "@/components/admin/StoreSurveySummary";
import { EmptyState } from "@/components/ui/empty-state";
import { formatIstDate } from "@/lib/datetime";
import { summariseSurvey, type BandTally } from "@/lib/owner-survey";
import { loadSurveyResponsesForAdmin, SURVEY_ADMIN_LIMIT } from "@/lib/owner-survey-server";
import { AuthError, requirePlatformRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin owner survey — AwaazOS" };

function BandList({ title, bands }: { title: string; bands: BandTally[] }) {
  return (
    <section className="rounded-lg border bg-card p-4 shadow-xs">
      <h2 className="font-semibold text-foreground">{title}</h2>
      <dl className="mt-2 space-y-1 text-sm">
        {bands.map((b) => (
          <div key={b.key} className="flex justify-between gap-3">
            <dt>{b.label}</dt>
            <dd className="font-semibold tabular-nums">{b.count}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * What owners told us (lib/owner-survey.ts): the pains ranked, to decide what to
 * build, then each store's answers with a link to set its price.
 */
export default async function AdminSurveyPage() {
  // Same rule as /admin/vendors: answers are per store, and 404 hides the page.
  try {
    await requirePlatformRole("SUPER_ADMIN");
  } catch (err) {
    if (err instanceof AuthError) notFound();
    throw err;
  }

  const rows = await loadSurveyResponsesForAdmin();
  const summary = summariseSurvey(rows);

  return (
    <div className="min-h-screen bg-background p-4 pb-10 md:p-6">
      <a href="#main" className="sr-only focus:not-sr-only">
        Skip to the results
      </a>
      <header className="mx-auto mb-6 max-w-3xl">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Internal · Platform admin</p>
        <h1 className="mt-1 font-display text-3xl font-bold text-foreground">Owner survey</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          What store owners say is hard, so we know what to build. {summary.responses}{" "}
          {summary.responses === 1 ? "store has" : "stores have"} answered.
        </p>
        <AdminNav current="/admin/survey" superAdmin />
      </header>

      <main id="main" className="mx-auto max-w-3xl space-y-6">
        {rows.length === 0 ? (
          <EmptyState
            title="No answers yet"
            description="Owners are asked on their orders screen, and can answer any time in Settings."
          />
        ) : (
          <>
            <section className="rounded-lg border bg-card p-4 shadow-xs">
              <h2 className="font-semibold text-foreground">What to build, most felt first</h2>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th scope="col" className="py-2 pr-3 font-medium">
                        Problem
                      </th>
                      <th scope="col" className="py-2 pr-3 text-right font-medium">
                        Hurts most
                      </th>
                      <th scope="col" className="py-2 text-right font-medium">
                        Named by
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.pains.map((pain) => (
                      <tr key={pain.key} className="border-b last:border-0">
                        <th scope="row" className="py-2 pr-3 text-left font-normal">
                          {pain.label}
                        </th>
                        <td className="py-2 pr-3 text-right font-semibold tabular-nums">{pain.top}</td>
                        <td className="py-2 text-right tabular-nums">{pain.named}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <div className="grid gap-4 sm:grid-cols-2">
              <BandList title="Orders a week" bands={summary.weeklyOrders} />
              <BandList title="Would pay a month, before GST" bands={summary.willingToPay} />
            </div>

            <section aria-labelledby="answers-heading">
              <h2 id="answers-heading" className="font-semibold text-foreground">
                Store by store
              </h2>
              <ul className="mt-2 space-y-4">
                {rows.map((row) => (
                  <li key={row.id} className="rounded-lg border bg-card p-4 shadow-xs">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="truncate font-semibold text-foreground">{row.vendor.name}</h3>
                        <p className="text-xs text-muted-foreground">Answered {formatIstDate(row.updatedAt)}</p>
                      </div>
                      <Link
                        href={`/admin/vendors?q=${encodeURIComponent(row.vendor.slug)}`}
                        className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4"
                      >
                        Set price
                      </Link>
                    </div>
                    <StoreSurveySummary answers={row} />
                  </li>
                ))}
              </ul>
              {rows.length === SURVEY_ADMIN_LIMIT ? (
                <p className="mt-4 text-sm text-muted-foreground">
                  Showing and counting the newest {SURVEY_ADMIN_LIMIT} answers.
                </p>
              ) : null}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
