"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { TransactionDetailDrawer, type TransactionDetailModel } from "@/components/transactions/TransactionDetailDrawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

  const [from, setFrom] = useState(initialQuery.from ?? "");
  const [to, setTo] = useState(initialQuery.to ?? "");
  const [status, setStatus] = useState(initialQuery.paymentStatus ?? "all");
  const [method, setMethod] = useState(initialQuery.paymentMethod ?? "all");

  const totalPages = Math.max(1, Math.ceil(initialTotal / initialLimit));

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

  function applyFilters() {
    const sp = new URLSearchParams();
    if (from) sp.set("from", from);
    if (to) sp.set("to", to);
    if (status !== "all") sp.set("paymentStatus", status);
    if (method !== "all") sp.set("paymentMethod", method);
    sp.set("page", "1");
    router.push(`/transactions?${sp.toString()}`);
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
      <div className="flex flex-col gap-3 rounded-lg border p-4 md:flex-row md:flex-wrap md:items-end">
        <div className="grid gap-2 sm:grid-cols-2 md:flex md:flex-1 md:flex-wrap">
          <div className="space-y-1">
            <Label htmlFor="tx-from">From</Label>
            <Input id="tx-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="tx-to">To</Label>
            <Input id="tx-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="PAID">Paid</SelectItem>
                <SelectItem value="FAILED">Failed</SelectItem>
                <SelectItem value="REFUNDED">Refunded</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Method</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="UPI">UPI</SelectItem>
                <SelectItem value="CASH">Cash</SelectItem>
                <SelectItem value="CARD">Card</SelectItem>
                <SelectItem value="RAZORPAY_LINK">Razorpay link</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" className="min-h-11" onClick={() => applyFilters()}>
              Apply filters
            </Button>
            {!canExportCsv ? (
              <Link
                href="/settings/billing"
                className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-primary underline underline-offset-4 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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

      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Page {initialPage} of {totalPages} · {initialTotal} total
        </p>
        <div className="flex gap-2">
          {initialPage > 1 ? (
            <Button type="button" variant="outline" asChild>
              <Link href={buildListUrl(initialPage - 1)} className="no-underline">
                Previous
              </Link>
            </Button>
          ) : (
            <Button type="button" variant="outline" disabled title="You are on the first page">
              Previous
            </Button>
          )}
          {initialHasMore ? (
            <Button type="button" variant="outline" asChild>
              <Link href={buildListUrl(initialPage + 1)} className="no-underline">
                Next
              </Link>
            </Button>
          ) : (
            <Button type="button" variant="outline" disabled title="You are on the last page">
              Next
            </Button>
          )}
        </div>
      </div>

      <TransactionDetailDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        transaction={selected}
        vendorName={vendorName}
      />
    </div>
  );
}
