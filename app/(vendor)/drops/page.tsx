import { ChevronRight, ClipboardList, Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { CopyDropButton, DropStatusBadge } from "@/components/drops/DropForm";
import { liveDropOrderWhere } from "@/lib/drops-api";
import { groupDropsByDay, istTodayYmd } from "@/lib/drops-builder";
import { effectiveDropStatus, type EffectiveDropStatus } from "@/lib/drops";
import { dbDateToYmd, formatDropDayLabel, formatFulfilmentWindow, formatIstDate, formatIstTime, utcToIstParts } from "@/lib/drops-time";
import { prisma } from "@/lib/prisma";
import { AuthError, requireVendorRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  title: string;
  date: string;
  dateObj: Date;
  effectiveStatus: EffectiveDropStatus;
  window: string;
  closesAt: Date;
  itemCount: number;
  orderCount: number;
};

const linkBtn =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

export default async function DropsPage() {
  let vendorId: string;
  try {
    const ctx = await requireVendorRole("MANAGER");
    vendorId = ctx.vendor.id;
  } catch (e) {
    if (e instanceof AuthError) redirect(e.status === 403 ? "/pos" : "/sign-in");
    throw e;
  }

  const now = new Date();
  const drops = await prisma.drop.findMany({
    where: { vendorId },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 60,
    include: { _count: { select: { items: true, transactions: { where: liveDropOrderWhere } } } },
  });

  const rows: Row[] = drops.map((d) => ({
    id: d.id,
    title: d.title,
    date: dbDateToYmd(d.date),
    dateObj: d.date,
    effectiveStatus: effectiveDropStatus(d, now),
    window: formatFulfilmentWindow(d.fulfilmentStartsAt, d.fulfilmentEndsAt),
    closesAt: d.closesAt,
    itemCount: d._count.items,
    orderCount: d._count.transactions,
  }));
  const { upcoming, past } = groupDropsByDay(rows, istTodayYmd(now));

  return (
    <div className="min-h-screen bg-background p-4 pb-10 md:p-6">
      <a
        href="#main-drops"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-100 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Skip to drops
      </a>
      <header className="mx-auto mb-6 flex max-w-3xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground">Drops</h1>
          <p className="text-sm text-muted-foreground">Daily pre-order menus. Customers order ahead, you cook once.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/pos" className={linkBtn}>
            Back to POS
          </Link>
          <Link
            href="/drops/new"
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground ring-offset-background transition-colors hover:bg-primary/90 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:flex-none"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            New drop
          </Link>
        </div>
      </header>

      <main id="main-drops" className="mx-auto max-w-3xl space-y-8">
        {rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center">
            <p className="font-medium">No drops yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Create one for tomorrow&apos;s cooking, share the link on WhatsApp, and collect orders before the cut-off.
            </p>
          </div>
        ) : null}

        {upcoming.length ? <DropSection title="Upcoming" rows={upcoming} /> : null}
        {past.length ? <DropSection title="Past" rows={past} /> : null}
      </main>
    </div>
  );
}

function DropSection({ title, rows }: { title: string; rows: Row[] }) {
  const id = `drops-${title.toLowerCase()}`;
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h2 id={id} className="font-display text-lg font-semibold">
        {title}
      </h2>
      <ul className="space-y-3">
        {rows.map((d) => (
          <li key={d.id} className="rounded-xl border border-border bg-card p-4 shadow-xs">
            <Link
              href={`/drops/${d.id}`}
              className="-m-1 flex items-start justify-between gap-3 rounded-md p-1 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="min-w-0 space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {formatDropDayLabel(d.dateObj)} · {formatIstDate(d.dateObj)}
                </p>
                <p className="truncate font-display text-lg font-semibold">{d.title}</p>
                <p className="text-sm text-muted-foreground">{d.window}</p>
                <p className="text-sm text-muted-foreground">
                  {d.itemCount} {d.itemCount === 1 ? "item" : "items"} · {d.orderCount}{" "}
                  {d.orderCount === 1 ? "order" : "orders"}
                  {d.effectiveStatus === "OPEN" || d.effectiveStatus === "SCHEDULED"
                    ? ` · orders close ${
                        dbDateToYmd(d.dateObj) === utcToIstParts(d.closesAt).ymd ? "" : `${formatIstDate(d.closesAt)} `
                      }${formatIstTime(d.closesAt)}`
                    : ""}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <DropStatusBadge status={d.effectiveStatus} />
                <span className="inline-flex items-center gap-1 text-sm font-medium text-primary">
                  <ClipboardList className="h-4 w-4" aria-hidden="true" />
                  Orders
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </span>
              </div>
            </Link>
            <div className="mt-3 flex gap-2">
              <CopyDropButton dropId={d.id} title={d.title} />
              <Link href={`/drops/${d.id}/edit`} className={linkBtn} aria-label={`Edit ${d.title}`}>
                <Pencil className="h-4 w-4" aria-hidden="true" />
                Edit
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
