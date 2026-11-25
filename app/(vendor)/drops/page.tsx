import {
  ClipboardList,
  Package,
  Pencil,
  Plus,
  Printer,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { BillingAccessNotice } from "@/components/billing/TrialNotice";
import { CopyDropButton, DropStatusBadge } from "@/components/drops/DropForm";
import { DropRowActionLabel, dropRowActionClass } from "@/components/drops/drop-row-action";
import { ShareDropButton } from "@/components/drops/ShareDropButton";
import { SetupChecklistCard } from "@/components/setup/SetupChecklistCard";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
        // Names only, for the share message on an open drop's row.
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
      <header className="mx-auto mb-6 flex max-w-3xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between lg:max-w-5xl">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground">
            Pre-orders
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
            New pre-order
          </Link>
        </div>
      </header>

      <main id="main-drops" className="mx-auto max-w-3xl space-y-8 lg:max-w-5xl">
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
            title="No pre-orders yet"
            description={`Create one for ${vocab.nextBatch}, share the link on WhatsApp, and collect orders before the cut-off. You can fill it in by voice.`}
            action={
              <Link href="/drops/new" className={primaryLinkBtn}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                New pre-order
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

/** When orders close ("28/11/2026 21:00", the date only when it isn't the cooking day), while it is or will be taking them. */
function closesAtText(d: Row): string | null {
  if (d.effectiveStatus !== "OPEN" && d.effectiveStatus !== "SCHEDULED") return null;
  const sameDay = dbDateToYmd(d.dateObj) === utcToIstParts(d.closesAt).ymd;
  return `${sameDay ? "" : `${formatIstDate(d.closesAt)} `}${formatIstTime(d.closesAt)}`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The row's icon tiles, always in the same order so the columns line up:
 * Orders · Share · Edit · Duplicate · Print prep. Each word says what the tile
 * does. The filled tile is the next step: share one that is taking orders,
 * duplicate a past one to sell it again. A draft or closed pre-order has no
 * filled tile: it is opened or reopened on the edit page, so its tile is Edit.
 */
function DropRowActions({ d, store, past }: { d: Row; store: Store; past: boolean }) {
  // Upcoming but not taking orders (draft, cut-off passed, closed by you): nothing to share yet.
  const notTakingOrders =
    !past && (d.stateKind === "draft" || d.stateKind === "cutoff_passed" || d.stateKind === "closed_by_seller");
  const shareable = !past && !notTakingOrders && (d.effectiveStatus === "OPEN" || d.effectiveStatus === "SCHEDULED");
  const ordersName = `Orders for ${d.title}`;
  const editName = `Edit ${d.title}`;
  const prepName = `Print prep sheet for ${d.title}`;

  return (
    <div className="flex flex-wrap items-center gap-1.5 lg:flex-nowrap">
      <Link href={dropOrdersHref(d.id)} aria-label={ordersName} title={ordersName} className={dropRowActionClass(false)}>
        <ClipboardList aria-hidden="true" />
        <DropRowActionLabel>Orders</DropRowActionLabel>
      </Link>
      {shareable ? (
        <ShareDropButton
          icon={{ primary: true }}
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
      ) : null}
      <Link href={`/drops/${d.id}/edit`} aria-label={editName} title={editName} className={dropRowActionClass(false)}>
        <Pencil aria-hidden="true" />
        <DropRowActionLabel>Edit</DropRowActionLabel>
      </Link>
      <CopyDropButton dropId={d.id} title={d.title} primary={past} />
      {d.orderCount > 0 ? (
        <Link href={`/drops/${d.id}/prep`} aria-label={prepName} title={prepName} className={dropRowActionClass(false)}>
          <Printer aria-hidden="true" />
          <DropRowActionLabel>Print prep</DropRowActionLabel>
        </Link>
      ) : null}
    </div>
  );
}

/**
 * One table per section. From `lg` it is a real grid (Date, Pre-order, Status,
 * Items, Orders, actions). Narrower, each row stacks into two blocks, the details
 * then the icon tiles with their words, so a 360 px phone never scrolls sideways.
 * Explicit roles keep the table semantics when a row's display is changed.
 */
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
      <div className="rounded-xl border border-border bg-card shadow-xs">
        <Table role="table" aria-labelledby={id}>
          <TableHeader className="hidden lg:table-header-group">
            <TableRow role="row" className="hover:bg-transparent">
              <TableHead role="columnheader" scope="col">Date</TableHead>
              <TableHead role="columnheader" scope="col">Pre-order</TableHead>
              <TableHead role="columnheader" scope="col">Status</TableHead>
              <TableHead role="columnheader" scope="col" className="text-right">Items</TableHead>
              <TableHead role="columnheader" scope="col" className="text-right">Orders</TableHead>
              <TableHead role="columnheader" scope="col">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((d) => {
              const closes = closesAtText(d);
              const day = `${formatDropDayLabel(d.dateObj)} · ${formatIstDate(d.dateObj)}`;
              return (
                <TableRow
                  key={d.id}
                  role="row"
                  data-testid="drop-row"
                  className="flex flex-col gap-3 p-4 lg:table-row lg:p-0"
                >
                  <TableCell role="cell" className="hidden whitespace-nowrap text-muted-foreground lg:table-cell">
                    {day}
                  </TableCell>
                  <TableCell role="cell" className="block p-0 lg:table-cell lg:p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground lg:hidden">
                          {day}
                        </p>
                        <Link
                          href={dropOrdersHref(d.id)}
                          className="-my-2 flex min-h-11 min-w-0 items-center rounded-md font-display text-lg font-semibold [overflow-wrap:anywhere] hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring lg:text-base"
                        >
                          {d.title}
                        </Link>
                        <p className="text-sm text-muted-foreground">{d.window}</p>
                        <p className="text-sm text-muted-foreground lg:hidden">
                          {plural(d.itemCount, "item", "items")} · {plural(d.orderCount, "order", "orders")}
                          {closes ? ` · orders close ${closes}` : ""}
                        </p>
                        {closes ? (
                          <p className="hidden text-sm text-muted-foreground lg:block">Orders close {closes}</p>
                        ) : null}
                      </div>
                      <div className="shrink-0 lg:hidden">
                        <DropStatusBadge status={d.effectiveStatus} label={d.stateLabel} />
                      </div>
                    </div>
                  </TableCell>
                  <TableCell role="cell" className="hidden whitespace-nowrap lg:table-cell">
                    <DropStatusBadge status={d.effectiveStatus} label={d.stateLabel} />
                  </TableCell>
                  <TableCell role="cell" className="hidden text-right tabular-nums lg:table-cell">
                    {d.itemCount}
                  </TableCell>
                  <TableCell role="cell" className="hidden text-right tabular-nums lg:table-cell">
                    {d.orderCount}
                  </TableCell>
                  <TableCell role="cell" className="block p-0 lg:table-cell lg:p-4">
                    <DropRowActions d={d} store={store} past={past} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
