import { notFound } from "next/navigation";

import { AdminNav } from "@/components/admin/AdminNav";
import { StoreHealthLine } from "@/components/admin/StoreHealthLine";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  DEMO_PIPELINE_LIMIT,
  DEMO_STAGE_LABEL,
  DEMO_STAGE_ORDER,
  countDemoStages,
  demoStage,
  listDemoPipeline,
  type DemoStage,
} from "@/lib/admin-demo-stores";
import { healthFor, loadStoreHealth } from "@/lib/admin-store-health";
import { formatIstDate } from "@/lib/datetime";
import { AuthError, requirePlatformRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin demo stores — AwaazOS" };

function stageDetail(stage: DemoStage): string | null {
  switch (stage.kind) {
    case "built":
      return "No claim link made yet.";
    case "invited":
      return `Sent ${formatIstDate(stage.sentAt)}, link works until ${formatIstDate(stage.expiresAt)}.`;
    case "invite_expired":
      return `Sent ${formatIstDate(stage.sentAt)}, expired ${formatIstDate(stage.expiredAt)}. Make a new link to follow up.`;
    case "claimed":
      return stage.claimedAt ? `Claimed ${formatIstDate(stage.claimedAt)}.` : null;
  }
}

export default async function AdminDemoStoresPage() {
  // Same rule as /admin/vendors: role read from the database, 404 rather than 403.
  try {
    await requirePlatformRole("SUPER_ADMIN");
  } catch (err) {
    if (err instanceof AuthError) notFound();
    throw err;
  }

  const now = new Date();
  const rows = await listDemoPipeline();
  const health = await loadStoreHealth(
    rows.map((r) => r.id),
    now,
  );
  const stages = rows.map((r) => demoStage(r, now));
  const counts = countDemoStages(stages);

  return (
    <div className="min-h-screen bg-background p-4 pb-10 md:p-6">
      <a href="#demo-stores" className="sr-only focus:not-sr-only">
        Skip to demo stores
      </a>
      <header className="mx-auto mb-6 max-w-3xl">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Internal · Platform admin</p>
        <h1 className="mt-1 font-display text-3xl font-bold text-foreground">Demo-store pipeline</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Every store built for a prospect, whether they claimed it, and whether they use it afterwards.
        </p>
        <AdminNav current="/admin/demo-stores" superAdmin />
      </header>

      <main id="main" className="mx-auto max-w-3xl">
        <section aria-labelledby="summary-heading" className="mb-6">
          <h2 id="summary-heading" className="sr-only">
            Summary
          </h2>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {DEMO_STAGE_ORDER.map((kind) => (
              <div key={kind} className="rounded-lg border bg-card p-3 shadow-xs">
                <dt className="text-xs text-muted-foreground">{DEMO_STAGE_LABEL[kind]}</dt>
                <dd className="mt-1 text-2xl font-bold tabular-nums text-foreground">{counts[kind]}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section id="demo-stores" aria-labelledby="demo-stores-heading">
          <h2 id="demo-stores-heading" className="sr-only">
            Demo stores
          </h2>
          {rows.length === 0 ? (
            <EmptyState
              title="No demo stores yet"
              description="Stores built with the internal demo-store API appear here."
            />
          ) : (
            <ul className="space-y-4">
              {rows.map((row, i) => {
                const stage = stages[i];
                const detail = stageDetail(stage);
                return (
                  <li key={row.id} className="rounded-lg border bg-card p-4 shadow-xs sm:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="truncate font-semibold text-foreground">{row.name}</h3>
                        <p className="truncate font-mono text-xs text-muted-foreground">
                          /s/{row.slug} · ref {row.demoExternalRef}
                        </p>
                      </div>
                      <Badge variant={stage.kind === "claimed" ? "default" : "outline"}>
                        {DEMO_STAGE_LABEL[stage.kind]}
                      </Badge>
                    </div>
                    {detail ? <p className="mt-2 text-sm text-foreground">{detail}</p> : null}
                    <p className="text-xs text-muted-foreground">Built {formatIstDate(row.createdAt)}</p>
                    <StoreHealthLine health={healthFor(health, row.id)} now={now} />
                  </li>
                );
              })}
            </ul>
          )}
          {rows.length === DEMO_PIPELINE_LIMIT ? (
            <p className="mt-4 text-sm text-muted-foreground">Showing the newest {DEMO_PIPELINE_LIMIT} demo stores.</p>
          ) : null}
        </section>
      </main>
    </div>
  );
}
