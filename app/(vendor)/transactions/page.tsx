import { redirect } from "next/navigation";

import { TransactionsTable } from "@/components/transactions/TransactionsTable";
import { getIstMonthStart, getIstTodayStart } from "@/lib/billing-period";
import { PLAN_LIMITS } from "@/lib/constants";
import { AuthError, requireVendorRole } from "@/lib/rbac";
import {
  parseTransactionListQuery,
  searchParamsToURLSearchParams,
  type ParsedTransactionListQuery,
} from "@/lib/transaction-list-params";
import { listVendorTransactions } from "@/lib/transactions-list";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function TransactionsPage(props: Props) {
  const searchParams = await props.searchParams;
  let ctx: Awaited<ReturnType<typeof requireVendorRole>>;
  try {
    ctx = await requireVendorRole("CASHIER");
  } catch (e) {
    if (e instanceof AuthError) {
      redirect("/sign-in");
    }
    throw e;
  }

  const sp = searchParamsToURLSearchParams(searchParams);
  const parsedList = parseTransactionListQuery(sp);
  let listParams: ParsedTransactionListQuery =
    "error" in parsedList ? { page: 1, limit: 20 } : parsedList;

  const { items, total } = await listVendorTransactions(ctx.vendor.id, listParams);
  const hasMore = listParams.page * listParams.limit < total;

  // Default CSV range: 1st of the current IST month → today. Both helpers return
  // UTC midnight of the IST calendar date, so the ISO date part is the IST day.
  const now = new Date();
  const defaultExportRange = {
    from: getIstMonthStart(now).toISOString().slice(0, 10),
    to: getIstTodayStart(now).toISOString().slice(0, 10),
  };

  const queryForClient: Record<string, string> = {};
  for (const [k, v] of Array.from(sp.entries())) {
    queryForClient[k] = v;
  }

  return (
    <div className="bg-background p-4 pb-10 md:p-6">
      <header className="mx-auto mb-4 max-w-5xl md:mb-6">
        <h1 className="font-display text-2xl font-bold text-foreground">Transactions</h1>
        <p className="text-sm text-muted-foreground">Bills and payments for {ctx.vendor.name}</p>
      </header>

      <main id="main" className="mx-auto max-w-5xl">
        <TransactionsTable
          initialItems={items}
          initialTotal={total}
          initialPage={listParams.page}
          initialLimit={listParams.limit}
          initialHasMore={hasMore}
          initialQuery={queryForClient}
          vendorName={ctx.vendor.name}
          canExportCsv={PLAN_LIMITS[ctx.vendor.plan].csvExport || ctx.access.kind === "locked"}
          defaultExportRange={defaultExportRange}
        />
      </main>
    </div>
  );
}
