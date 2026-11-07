import {
  ChevronRight,
  ClipboardList,
  Package,
  Pencil,
  Plus,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { BillingAccessNotice } from "@/components/billing/TrialNotice";
import { CopyDropButton, DropStatusBadge } from "@/components/drops/DropForm";
import { ShareDropButton } from "@/components/drops/ShareDropButton";
import { SetupChecklistCard } from "@/components/setup/SetupChecklistCard";
import { EmptyState } from "@/components/ui/empty-state";
import { liveDropOrderWhere } from "@/lib/drops-api";
import { dropOrdersHref } from "@/lib/drops-board";
import { groupDropsByDay, istTodayYmd } from "@/lib/drops-builder";
import { dropStateKind, dropStateLabel, type DropStateKind } from "@/lib/drop-state";
import { effectiveDropStatus, remainingQty, soldQtyByDropItem, type EffectiveDropStatus } from "@/lib/drops";
import {
  dbDateToYmd,
  formatDropDayLabel,
  formatIstDate,
  formatIstTime,
  formatWindowWithDay,
  utcToIstParts,
} from "@/lib/drops-time";
import { prisma } from "@/lib/prisma";
import { AuthError, requireVendorRole } from "@/lib/rbac";
import { storeVocabulary } from "@/lib/store-vocabulary";
import { loadSetupChecklist } from "@/lib/setup-checklist-server";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  title: string;
  date: string;
  dateObj: Date;
  effectiveStatus: EffectiveDropStatus;
  /** Why it is or isn't taking orders (lib/drop-state.ts). */
  stateKind: DropStateKind;
  stateLabel: string;
  window: string;
  closesAt: Date;
  fulfilmentStartsAt: Date;
  fulfilmentEndsAt: Date;
  fulfilmentMode: "DELIVERY" | "PICKUP" | "BOTH";
  itemNames: string[];
  itemCount: number;
  orderCount: number;
};

type Store = { name: string; slug: string };

const primaryLinkBtn =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground ring-offset-background transition-colors hover:bg-primary/90 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

const linkBtn =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

export default async function DropsPage() {
  let ctx: Awaited<ReturnType<typeof requireVendorRole>>;
  let vendorId: string;
  let store: Store;
  try {
    ctx = await requireVendorRole("MANAGER");
    vendorId = ctx.vendor.id;
    store = { name: ctx.vendor.name, slug: ctx.vendor.slug };
  } catch (e) {
    if (e instanceof AuthError)
      redirect(e.status === 403 ? "/pos" : "/sign-in");
    throw e;
  }
  const vocab = storeVocabulary(ctx.vendor.stallType);

  const now = new Date();
  const [drops, setup] = await Promise.all([
    prisma.drop.findMany({
      where: { vendorId },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 60,
      include: {
        // Names only, for the share message on an open drop's card.
        items: {
          orderBy: { sortOrder: "asc" },
          select: { id: true, maxQty: true, menuItem: { select: { name: true } } },
        },
        _count: { select: { transactions: { where: liveDropOrderWhere } } },
      },
    }),
    loadSetupChecklist({ vendor: ctx.vendor, role: ctx.staff.role }),
  ]);

  // Sold out is the one reason that needs stock: count it for open drops only.
  const soldOutIds = new Set(
    (
      await Promise.all(
        drops
          .filter((d) => effectiveDropStatus(d, now) === "OPEN" && d.items.length > 0 && d.items.every((i) => i.maxQty !== null))
          .map(async (d) => {
            const sold = await soldQtyByDropItem(prisma, d.id, now);
            return d.items.every((i) => remainingQty(i.maxQty, sold.get(i.id) ?? 0) === 0) ? d.id : null;
          }),
      )
    ).filter((id): id is string => id !== null),
  );

  const rows: Row[] = drops.map((d) => ({
    id: d.id,
    title: d.title,
    date: dbDateToYmd(d.date),
    dateObj: d.date,
    effectiveStatus: effectiveDropStatus(d, now),
    stateKind: dropStateKind(d, now, soldOutIds.has(d.id)),
    stateLabel: dropStateLabel(d, now, { soldOut: soldOutIds.has(d.id) }),
    window: formatWindowWithDay(d.fulfilmentStartsAt, d.fulfilmentEndsAt, now),
    closesAt: d.closesAt,
    fulfilmentStartsAt: d.fulfilmentStartsAt,
    fulfilmentEndsAt: d.fulfilmentEndsAt,
    fulfilmentMode: d.fulfilmentMode,
    itemNames: d.items.map((i) => i.menuItem.name),
    itemCount: d.items.length,
    orderCount: d._count.transactions,
  }));
  const { upcoming, past } = groupDropsByDay(rows, istTodayYmd(now));

  return (
    <div className="bg-background p-4 pb-10 md:p-6">
      <header className="mx-auto mb-6 flex max-w-3xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground">
            Drops
          </h1>
          <p className="text-sm text-muted-foreground">
            {vocab.kind === "food"
              ? "Pre-order menus with a cut-off. Customers order ahead, you cook once."
              : "Pre-order batches with a cut-off. Customers order ahead, you pack once."}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/drops/new"
            className={`${primaryLinkBtn} flex-1 sm:flex-none`}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            New drop
          </Link>
        </div>
      </header>

      <main id="main-drops" className="mx-auto max-w-3xl space-y-8">
        {(ctx.access.kind !== "paid" || setup.items.length > 0) && (
          <div>
            <BillingAccessNotice
              access={ctx.access}
              isOwner={ctx.staff.role === "OWNER"}
              className="mb-3"
            />
            <SetupChecklistCard {...setup} />
          </div>
        )}

        {rows.length === 0 ? (
          <EmptyState
            className="rounded-xl"
            icon={Package}
            title="No drops yet"
            description={`Create one for ${vocab.nextBatch}, share the link on WhatsApp, and collect orders before the cut-off. You can fill it in by voice.`}
            action={
              <Link href="/drops/new" className={primaryLinkBtn}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                New drop
              </Link>
            }
          />
        ) : null}

        {upcoming.length ? (
          <DropSection title="Upcoming" rows={upcoming} store={store} past={false} />
        ) : null}
        {past.length ? (
          <DropSection title="Past" rows={past} store={store} past />
        ) : null}
      </main>
    </div>
  );
}

/**
 * The card's main button is the next step for that drop: open orders on an
 * upcoming one that isn't taking them, share one that is, sell a past one again.
 * "Copy for tomorrow" is the main button only on past drops.
 */
function DropActions({ d, store, past }: { d: Row; store: Store; past: boolean }) {
  const edit = (
    <Link
      href={`/drops/${d.id}/edit`}
      className={`${linkBtn} flex-1`}
      aria-label={`Edit ${d.title}`}
    >
      <Pencil className="h-4 w-4" aria-hidden="true" />
      Edit
    </Link>
  );
  if (past) {
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        <CopyDropButton dropId={d.id} title={d.title} />
        {edit}
      </div>
    );
  }
  // Upcoming, not taking orders: the edit page saves and opens it (or reopens a closed one).
  if (d.stateKind === "draft" || d.stateKind === "cutoff_passed" || d.stateKind === "closed_by_seller") {
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          href={`/drops/${d.id}/edit`}
          className={`${primaryLinkBtn} flex-1`}
          aria-label={`Open orders for ${d.title}`}
        >
          Open orders
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Link>
        <CopyDropButton dropId={d.id} title={d.title} secondary />
      </div>
    );
  }
  if (d.effectiveStatus === "OPEN" || d.effectiveStatus === "SCHEDULED") {
    return (
      <div className="mt-3 space-y-2">
        <ShareDropButton
          compact
          dropId={d.id}
          vendorName={store.name}
          vendorSlug={store.slug}
          dropTitle={d.title}
          closesAt={d.closesAt.toISOString()}
          fulfilmentStartsAt={d.fulfilmentStartsAt.toISOString()}
          fulfilmentEndsAt={d.fulfilmentEndsAt.toISOString()}
          fulfilmentMode={d.fulfilmentMode}
          itemNames={d.itemNames}
        />
        <div className="flex flex-wrap gap-2">
          {edit}
          <CopyDropButton dropId={d.id} title={d.title} secondary />
        </div>
      </div>
    );
  }
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {edit}
      <CopyDropButton dropId={d.id} title={d.title} secondary />
    </div>
  );
}

function DropSection({
  title,
  rows,
  store,
  past,
}: {
  title: string;
  rows: Row[];
  store: Store;
  past: boolean;
}) {
  const id = `drops-${title.toLowerCase()}`;
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h2 id={id} className="font-display text-lg font-semibold">
        {title}
      </h2>
      <ul className="space-y-3">
        {rows.map((d) => (
          <li
            key={d.id}
            className="rounded-xl border border-border bg-card p-4 shadow-xs"
          >
            <Link
              href={dropOrdersHref(d.id)}
              className="-m-1 flex items-start justify-between gap-3 rounded-md p-1 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="min-w-0 space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {formatDropDayLabel(d.dateObj)} · {formatIstDate(d.dateObj)}
                </p>
                <p className="truncate font-display text-lg font-semibold">
                  {d.title}
                </p>
                <p className="text-sm text-muted-foreground">{d.window}</p>
                <p className="text-sm text-muted-foreground">
                  {d.itemCount} {d.itemCount === 1 ? "item" : "items"} ·{" "}
                  {d.orderCount} {d.orderCount === 1 ? "order" : "orders"}
                  {d.effectiveStatus === "OPEN" ||
                  d.effectiveStatus === "SCHEDULED"
                    ? ` · orders close ${
                        dbDateToYmd(d.dateObj) === utcToIstParts(d.closesAt).ymd
                          ? ""
                          : `${formatIstDate(d.closesAt)} `
                      }${formatIstTime(d.closesAt)}`
                    : ""}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <DropStatusBadge status={d.effectiveStatus} label={d.stateLabel} />
                <span className="inline-flex items-center gap-1 text-sm font-medium text-primary">
                  <ClipboardList className="h-4 w-4" aria-hidden="true" />
                  Orders
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </span>
              </div>
            </Link>
            <DropActions d={d} store={store} past={past} />
          </li>
        ))}
      </ul>
    </section>
  );
}
