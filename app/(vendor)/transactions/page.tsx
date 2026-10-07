import Link from "next/link";
import { redirect } from "next/navigation";

import { TransactionsTable } from "@/components/transactions/TransactionsTable";
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

  const queryForClient: Record<string, string> = {};
  for (const [k, v] of Array.from(sp.entries())) {
    queryForClient[k] = v;
  }

  return (
    <div className="min-h-screen bg-background p-4 pb-10 md:p-6">
      <header className="mx-auto mb-6 flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Transactions</h1>
          <p className="text-sm text-muted-foreground">Bills and payments for {ctx.vendor.name}</p>
        </div>
        <Link
          href="/pos"
          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          Back to POS
        </Link>
      </header>

      <div className="mx-auto max-w-5xl">
        <TransactionsTable
          initialItems={items}
          initialTotal={total}
          initialPage={listParams.page}
          initialLimit={listParams.limit}
          initialHasMore={hasMore}
          initialQuery={queryForClient}
          vendorName={ctx.vendor.name}
          canExportCsv={PLAN_LIMITS[ctx.vendor.plan].csvExport}
        />
      </div>
    </div>
  );
}
