"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ReceiptText, SlidersHorizontal } from "lucide-react";

import { TransactionCardList } from "@/components/transactions/TransactionCardList";
import { TransactionDetailDrawer, type TransactionDetailModel } from "@/components/transactions/TransactionDetailDrawer";
import {
  EMPTY_TRANSACTION_FILTERS,
  TransactionFilterFields,
  type TransactionFilterValues,
} from "@/components/transactions/TransactionFilterFields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatINR } from "@/lib/currency";
import { formatIstDateTime } from "@/lib/datetime";
import type { TransactionListRow } from "@/lib/transactions-list";

function toDetailModel(row: TransactionListRow): TransactionDetailModel {
  const created =
    row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt);
  return {
    id: row.id,
    billNumber: row.billNumber,
    createdAt: created,
    subtotalPaise: row.subtotalPaise,
    discountPaise: row.discountPaise,
    taxPaise: row.taxPaise,
    totalPaise: row.totalPaise,
    paymentMethod: row.paymentMethod,
    paymentStatus: row.paymentStatus,
    customerPhone: row.customerPhone,
    customerName: row.customerName,
    voiceTranscript: row.voiceTranscript,
    upiRef: row.upiRef,
    orderItems: row.orderItems.map((o) => ({
      id: o.id,
      name: o.name,
      qty: o.qty,
      priceInPaise: o.priceInPaise,
      totalPaise: o.totalPaise,
    })),
    receipt: row.receipt
      ? { receiptNumber: row.receipt.receiptNumber, whatsappSent: row.receipt.whatsappSent }
      : null,
  };
}

function itemQtySum(row: TransactionListRow): number {
  return row.orderItems.reduce((s, o) => s + o.qty, 0);
}

type Props = {
  initialItems: TransactionListRow[];
  initialTotal: number;
  initialPage: number;
  initialLimit: number;
  initialHasMore: boolean;
  initialQuery: Record<string, string>;
  vendorName: string;
  canExportCsv: boolean;
  /** Current IST month (1st → today) as YYYY-MM-DD, used when From/To are both empty. */
  defaultExportRange: { from: string; to: string };
};

/** "2026-10-08" → "08/10/2026" (the value is already an IST calendar date). */
function ymdToDisplay(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}

export function TransactionsTable({
  initialItems,
  initialTotal,
  initialPage,
  initialLimit,
  initialHasMore,
  initialQuery,
  vendorName,
  canExportCsv,
  defaultExportRange,
}: Props) {
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selected, setSelected] = useState<TransactionDetailModel | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // One set of values behind both filter UIs (inline row on md+, sheet on phones).
  const [filters, setFilters] = useState<TransactionFilterValues>({
    from: initialQuery.from ?? "",
    to: initialQuery.to ?? "",
    status: initialQuery.paymentStatus ?? "all",
    method: initialQuery.paymentMethod ?? "all",
  });
  const { from, to } = filters;
  const patchFilters = (patch: Partial<TransactionFilterValues>) => setFilters((f) => ({ ...f, ...patch }));

  const totalPages = Math.max(1, Math.ceil(initialTotal / initialLimit));

  // Counts what the list on screen is filtered by (the URL), not what is typed in the fields.
  const activeFilterCount = [
    initialQuery.from,
    initialQuery.to,
    initialQuery.paymentStatus !== "all" ? initialQuery.paymentStatus : undefined,
    initialQuery.paymentMethod !== "all" ? initialQuery.paymentMethod : undefined,
  ].filter(Boolean).length;
  const neverSold = initialTotal === 0 && activeFilterCount === 0 && !initialQuery.source;

  function buildListUrl(page: number) {
    const sp = new URLSearchParams();
    if (initialQuery.from) sp.set("from", initialQuery.from);
    if (initialQuery.to) sp.set("to", initialQuery.to);
    if (initialQuery.paymentStatus && initialQuery.paymentStatus !== "all") {
      sp.set("paymentStatus", initialQuery.paymentStatus);
    }
    if (initialQuery.paymentMethod && initialQuery.paymentMethod !== "all") {
      sp.set("paymentMethod", initialQuery.paymentMethod);
    }
    if (initialQuery.source) sp.set("source", initialQuery.source);
    sp.set("page", String(page));
    return `/transactions?${sp.toString()}`;
  }

  function applyFilters(values: TransactionFilterValues = filters) {
    const sp = new URLSearchParams();
    if (values.from) sp.set("from", values.from);
    if (values.to) sp.set("to", values.to);
    if (values.status !== "all") sp.set("paymentStatus", values.status);
    if (values.method !== "all") sp.set("paymentMethod", values.method);
    sp.set("page", "1");
    router.push(`/transactions?${sp.toString()}`);
  }

  function clearFilters() {
    setFilters(EMPTY_TRANSACTION_FILTERS);
    applyFilters(EMPTY_TRANSACTION_FILTERS);
    setFiltersOpen(false);
  }

  function openRow(row: TransactionListRow) {
    setSelected(toDetailModel(row));
    setDrawerOpen(true);
  }

  // Both dates empty → export the current IST month so the button works on first load.
  // Exactly one date set → ask for the other rather than guessing.
  const usingDefaultRange = !from && !to;
  const exportRange = usingDefaultRange ? defaultExportRange : from && to ? { from, to } : null;
  const exportHref = exportRange
    ? `/api/transactions/export?from=${encodeURIComponent(exportRange.from)}&to=${encodeURIComponent(exportRange.to)}`
    : undefined;

  return (
    <div className="space-y-4">
      {/* Phones: a compact bar (Filters + Export). md+: the inline filter row.
          The export controls are one set of elements shared by both. */}
      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end md:rounded-lg md:border md:p-4">
        <div className="hidden md:flex md:flex-1 md:flex-wrap md:gap-2">
          <TransactionFilterFields
            idPrefix="tx"
            values={filters}
            onChange={patchFilters}
            selectClassName="w-[180px]"
          />
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="min-h-11 flex-1 md:hidden"
              aria-haspopup="dialog"
              onClick={() => setFiltersOpen(true)}
            >
              <SlidersHorizontal aria-hidden="true" />
              Filters
              {activeFilterCount > 0 ? (
                <span
                  data-testid="active-filter-count"
                  className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold tabular-nums text-primary-foreground"
                >
                  {activeFilterCount}
                  <span className="sr-only"> active</span>
                </span>
              ) : null}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="hidden min-h-11 md:inline-flex"
              onClick={() => applyFilters()}
            >
              Apply filters
            </Button>
            {!canExportCsv ? (
              <Link
                href="/settings/billing"
                className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-primary underline underline-offset-4 hover:no-underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Export CSV · Upgrade to Starter
              </Link>
            ) : exportHref ? (
              <Button type="button" variant="outline" className="min-h-11" asChild>
                <a href={exportHref} className="no-underline">
                  Export CSV
                </a>
              </Button>
            ) : null}
          </div>
          {canExportCsv ? (
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {exportRange
                ? usingDefaultRange
                  ? `Exports this month: ${ymdToDisplay(exportRange.from)} – ${ymdToDisplay(exportRange.to)}`
                  : `Exports ${ymdToDisplay(exportRange.from)} – ${ymdToDisplay(exportRange.to)}`
                : "Pick a date range to export"}
            </p>
          ) : null}
        </div>
      </div>

      {/* One list, two layouts, switched in CSS: display:none keeps the unused
          one out of the accessibility tree and nothing flashes on hydration. */}
      {initialItems.length === 0 ? (
        <div
          data-testid="transactions-empty"
          className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-10 text-center md:hidden"
        >
          <ReceiptText className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            {neverSold ? "No transactions yet. Bills you ring up show here." : "No transactions match your filters."}
          </p>
          {activeFilterCount > 0 ? (
            <Button type="button" variant="outline" className="min-h-11" onClick={clearFilters}>
              Clear filters
            </Button>
          ) : null}
        </div>
      ) : (
        <TransactionCardList
          items={initialItems}
          onOpen={openRow}
          className="overflow-hidden rounded-lg border md:hidden"
        />
      )}

      <div className="hidden md:block" data-testid="transactions-table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Bill #</TableHead>
              <TableHead>Date / time (IST)</TableHead>
              <TableHead className="text-right">Items</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {initialItems.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  No transactions match your filters.
                </TableCell>
              </TableRow>
            ) : (
              initialItems.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer"
                  onClick={() => openRow(row)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openRow(row);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                >
                  <TableCell className="font-mono text-xs">{row.billNumber}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm">{formatIstDateTime(row.createdAt)}</TableCell>
                  <TableCell className="text-right tabular-nums">{itemQtySum(row)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatINR(row.totalPaise)}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{row.paymentMethod}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        row.paymentStatus === "PAID"
                          ? "default"
                          : row.paymentStatus === "PENDING"
                            ? "secondary"
                            : "destructive"
                      }
                    >
                      {row.paymentStatus}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <nav
        aria-label="Pagination"
        className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
      >
        <p className="text-sm text-muted-foreground">
          Page {initialPage} of {totalPages} · {initialTotal} total
        </p>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          {initialPage > 1 ? (
            <Button type="button" variant="outline" className="min-h-11" asChild>
              <Link href={buildListUrl(initialPage - 1)} className="no-underline">
                Previous
              </Link>
            </Button>
          ) : (
            <Button type="button" variant="outline" className="min-h-11" disabled title="You are on the first page">
              Previous
            </Button>
          )}
          {initialHasMore ? (
            <Button type="button" variant="outline" className="min-h-11" asChild>
              <Link href={buildListUrl(initialPage + 1)} className="no-underline">
                Next
              </Link>
            </Button>
          ) : (
            <Button type="button" variant="outline" className="min-h-11" disabled title="You are on the last page">
              Next
            </Button>
          )}
        </div>
      </nav>

      <ResponsiveDialog open={filtersOpen} onOpenChange={setFiltersOpen}>
        <ResponsiveDialogContent>
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(e) => {
              e.preventDefault();
              applyFilters();
              setFiltersOpen(false);
            }}
          >
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>Filters</ResponsiveDialogTitle>
              <ResponsiveDialogDescription>
                Narrow the list by date, status or payment method.
              </ResponsiveDialogDescription>
            </ResponsiveDialogHeader>
            <ResponsiveDialogBody className="grid gap-4">
              <TransactionFilterFields idPrefix="tx-sheet" values={filters} onChange={patchFilters} />
            </ResponsiveDialogBody>
            <ResponsiveDialogFooter>
              <Button type="button" variant="outline" className="min-h-11" onClick={clearFilters}>
                Clear
              </Button>
              <Button type="submit" className="min-h-11">
                Apply filters
              </Button>
            </ResponsiveDialogFooter>
          </form>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <TransactionDetailDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        transaction={selected}
        vendorName={vendorName}
      />
    </div>
  );
}
