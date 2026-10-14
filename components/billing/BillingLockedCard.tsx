import type { StaffRole } from "@prisma/client";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { formatIstDate } from "@/lib/datetime";
import { PLAN_MARKETING } from "@/lib/plan-copy";

/**
 * Shown instead of a selling screen when the vendor is locked (trial over or
 * paid period ended, not subscribed — `billingAccess` in lib/plan.ts). Records
 * stay reachable, so it always links to bills and, for the owner, billing.
 */
export function BillingLockedCard({ since, staffRole }: { since: Date; staffRole: StaffRole }) {
  const starter = PLAN_MARKETING.STARTER;
  const isOwner = staffRole === "OWNER";
  return (
    <main className="mx-auto flex min-h-[70dvh] max-w-lg flex-col justify-center px-4 py-10">
      <section className="rounded-xl border bg-card p-6 shadow-xs" aria-labelledby="billing-locked-heading">
        <h1 id="billing-locked-heading" className="font-display text-2xl font-semibold">
          Subscribe to keep selling
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Your free trial or paid period ended on {formatIstDate(since)}. New bills and online
          orders are paused until you subscribe. Your bills, reports and settings are all still here.
        </p>
        <p className="mt-4 text-lg font-semibold">
          {starter.price}
          <span className="block text-sm font-normal text-muted-foreground">
            or {starter.yearlyPrice} — {starter.yearlyNote}
          </span>
        </p>
        <div className="mt-6 flex flex-col gap-3">
          {isOwner ? (
            <Button asChild className="min-h-11 w-full">
              <Link href="/settings/billing">Choose a plan</Link>
            </Button>
          ) : (
            <p className="rounded-md border bg-muted/50 p-3 text-sm" role="status">
              Only the store owner can subscribe. Please ask them to open Settings → Plan &amp; billing.
            </p>
          )}
          <Button asChild variant="outline" className="min-h-11 w-full">
            <Link href="/transactions">View past bills</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
