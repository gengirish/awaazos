"use client";

import { ChevronRight, ReceiptText } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { readRecentOrders, type RecentOrder } from "@/components/storefront/recent-orders";

/**
 * "Your recent order · AWZ-… · View" on the store page, for a buyer who
 * ordered from this device (recent-orders.ts) and came back through the store
 * link. Read after mount, so the server HTML and the first client render match;
 * renders nothing when there is no remembered order or storage is blocked.
 *
 * It sits in the header's pill row, which is already 44 px tall and
 * right-aligned: appearing late moves nothing else on the page. The bill
 * number is shown from `sm` up; on a 360 px phone the row has room for the
 * label only, so the full text is the link's accessible name.
 */
export function RecentOrderLink({ slug }: { slug: string }) {
  const [order, setOrder] = useState<RecentOrder | null>(null);

  useEffect(() => {
    setOrder(readRecentOrders(slug)[0] ?? null);
  }, [slug]);

  if (!order) return null;
  return (
    <Link
      href={`/s/${encodeURIComponent(slug)}/o/${encodeURIComponent(order.token)}`}
      aria-label={`Your recent order · ${order.billNumber} · View`}
      className="mr-auto inline-flex min-h-11 min-w-11 items-center gap-1.5 rounded-full border border-primary/40 bg-background/90 px-3.5 text-xs font-semibold text-foreground shadow-xs transition-colors hover:border-primary/60 hover:text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
    >
      <ReceiptText className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <span className="min-w-0 truncate">
        Your <span className="hidden sm:inline">recent </span>order
        <span className="hidden font-mono sm:inline"> · {order.billNumber}</span>
      </span>
      <ChevronRight className="hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" aria-hidden="true" />
    </Link>
  );
}
