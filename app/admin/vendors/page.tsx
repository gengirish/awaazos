import { notFound } from "next/navigation";

import { AdminNav } from "@/components/admin/AdminNav";
import { FreeAccessForm } from "@/components/admin/FreeAccessForm";
import { StoreHealthLine } from "@/components/admin/StoreHealthLine";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { freeAccessMaxYmd, istTodayYmd } from "@/lib/admin-free-access";
import { healthFor, loadStoreHealth } from "@/lib/admin-store-health";
import { ADMIN_VENDOR_LIST_LIMIT, listAdminVendors, type AdminVendorRow } from "@/lib/admin-vendors";
import { PLAN_LIMITS } from "@/lib/constants";
import { formatIstDate } from "@/lib/datetime";
import { utcToIstParts } from "@/lib/drops-time";
import { billingAccess, trialDaysLeft } from "@/lib/plan";
import { AuthError, requirePlatformRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin stores — AwaazOS" };

/** Where the store stands today, and what a free-until date would change. */
function describeBilling(vendor: AdminVendorRow, now: Date): { status: string; note: string | null } {
  const access = billingAccess(vendor, now);
  switch (access.kind) {
    case "paid":
      return {
        status: vendor.planExpiresAt
          ? `${PLAN_LIMITS[access.plan].label}, paid until ${formatIstDate(vendor.planExpiresAt)}`
          : `${PLAN_LIMITS[access.plan].label}, paid`,
        note: "This store is paying. A free-until date only applies if their plan runs out before it.",
      };
    case "trial": {
      const days = trialDaysLeft(access.endsAt, now);
      return {
        status: `Free until ${formatIstDate(access.endsAt)} (${days} ${days === 1 ? "day" : "days"} left)`,
        note: null,
      };
    }
    case "locked":
      return { status: `Locked since ${formatIstDate(access.since)}`, note: null };
    case "free":
      return {
        status: "Old free tier, no end date",
        note: "This store never locks today. With a date it gets Starter features until then, and locks afterwards unless they subscribe.",
      };
  }
}

export default async function AdminVendorsPage(props: { searchParams: Promise<{ q?: string | string[] }> }) {
  // Same rule as /admin/metrics: role read from the database, and 404 rather
  // than 403 so the page does not disclose that it exists.
  try {
    await requirePlatformRole("SUPER_ADMIN");
  } catch (err) {
    if (err instanceof AuthError) notFound();
    throw err;
  }

  const { q: rawQ } = await props.searchParams;
  const q = (Array.isArray(rawQ) ? rawQ[0] : rawQ)?.trim().slice(0, 100) ?? "";

  const now = new Date();
  const vendors = await listAdminVendors(q);
  const health = await loadStoreHealth(
    vendors.map((v) => v.id),
    now,
  );
  const todayYmd = istTodayYmd(now);
  const maxYmd = freeAccessMaxYmd(now);

  return (
    <div className="min-h-screen bg-background p-4 pb-10 md:p-6">
      <a href="#stores" className="sr-only focus:not-sr-only">
        Skip to stores
      </a>
      <header className="mx-auto mb-6 max-w-3xl">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Internal · Platform admin</p>
        <h1 className="mt-1 font-display text-3xl font-bold text-foreground">Stores</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Let a store use AwaazOS free until a date you pick. It keeps Starter features and is not asked to pay
          before then.
        </p>
        <AdminNav current="/admin/vendors" superAdmin />
      </header>

      <main id="main" className="mx-auto max-w-3xl">
        <form method="get" role="search" className="mb-6 flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <Label htmlFor="store-search">Search by store name or link</Label>
            <Input id="store-search" name="q" type="search" defaultValue={q} className="mt-1" />
          </div>
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>

        <section id="stores" aria-labelledby="stores-heading">
          <h2 id="stores-heading" className="sr-only">
            Stores
          </h2>
          {vendors.length === 0 ? (
            <EmptyState
              role={q ? "status" : undefined}
              title={q ? "No store matches that search" : "No stores yet"}
              description={q ? "Try part of the store name or its link." : "Stores appear here once someone signs up."}
            />
          ) : (
            <ul className="space-y-4">
              {vendors.map((vendor) => {
                const { status, note } = describeBilling(vendor, now);
                const currentYmd =
                  vendor.trialEndsAt && vendor.trialEndsAt.getTime() > now.getTime()
                    ? utcToIstParts(vendor.trialEndsAt).ymd
                    : null;
                return (
                  <li key={vendor.id} className="rounded-lg border bg-card p-4 shadow-xs sm:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="truncate font-semibold text-foreground">{vendor.name}</h3>
                        <p className="truncate font-mono text-xs text-muted-foreground">/s/{vendor.slug}</p>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {vendor.isDemo ? <Badge variant="outline">Demo</Badge> : null}
                        {vendor.isActive ? null : <Badge variant="secondary">Inactive</Badge>}
                      </div>
                    </div>
                    <p className="mt-2 text-sm text-foreground">{status}</p>
                    <p className="text-xs text-muted-foreground">Signed up {formatIstDate(vendor.createdAt)}</p>
                    <StoreHealthLine health={healthFor(health, vendor.id)} now={now} />
                    {note ? <p className="mt-2 text-sm text-muted-foreground">{note}</p> : null}
                    <div className="mt-4">
                      <FreeAccessForm
                        vendorId={vendor.id}
                        vendorName={vendor.name}
                        currentYmd={currentYmd}
                        todayYmd={todayYmd}
                        maxYmd={maxYmd}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {vendors.length === ADMIN_VENDOR_LIST_LIMIT ? (
            <p className="mt-4 text-sm text-muted-foreground">
              Showing the newest {ADMIN_VENDOR_LIST_LIMIT} stores. Search to find an older one.
            </p>
          ) : null}
        </section>
      </main>
    </div>
  );
}
