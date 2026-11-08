import Link from "next/link";

import { Notice } from "@/components/ui/notice";
import { formatIstDate } from "@/lib/datetime";
import { trialDaysLeft, type BillingAccess } from "@/lib/plan";
import { cn } from "@/lib/utils";

/** Days before the trial ends at which selling screens start showing the notice. */
export const TRIAL_NOTICE_DAYS = 5;

const PLAN_LINK = "inline-flex min-h-11 items-center font-semibold underline underline-offset-4";

/**
 * "Trial ends in N days" strip for selling screens. Rendered on the server per
 * request from `trialEndsAt` — no timer. Returns null outside the last
 * `TRIAL_NOTICE_DAYS` days.
 *
 * The default box is the full-width strip above the till. On another page use
 * `BillingAccessNotice` below, which fits it to that page's column.
 */
export function TrialNotice({
  endsAt,
  now,
  isOwner,
  variant = "strip",
  className,
}: {
  endsAt: Date;
  now: Date;
  isOwner: boolean;
  /** `strip`: full-width bar above the till. `box`: a bordered box sized by `className`. */
  variant?: "strip" | "box";
  className?: string;
}) {
  const days = trialDaysLeft(endsAt, now);
  if (days > TRIAL_NOTICE_DAYS) return null;
  const when = days <= 1 ? "today" : `in ${days} days`;
  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center justify-between gap-2 bg-amber-50 px-4 py-2 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-50",
        variant === "strip" ? "mx-auto max-w-lg border-b md:max-w-6xl" : "rounded-md border border-amber-500/60",
        className,
      )}
    >
      <span>
        <strong className="font-semibold">Free trial ends {when}</strong> ({formatIstDate(endsAt)}). Subscribe to
        keep selling after that.
      </span>
      {isOwner ? (
        <Link href="/settings/billing" className={PLAN_LINK}>
          Choose a plan
        </Link>
      ) : null}
    </div>
  );
}

/**
 * For screens a locked vendor may still use (the orders board, drops): says
 * that buyers can't order, without blocking the page. Existing orders keep
 * working (see "Billing" in CLAUDE.md). The till shows `BillingLockedCard`
 * instead, because nothing on it works while locked.
 */
export function OrdersPausedNotice({ isOwner, className }: { isOwner: boolean; className?: string }) {
  return (
    <Notice icon className={className}>
      <p>
        <strong className="font-semibold">Customers can&apos;t place new orders until you subscribe.</strong> Your
        existing orders still work.
      </p>
      {isOwner ? (
        <Link href="/settings/billing" className={PLAN_LINK}>
          Choose a plan
        </Link>
      ) : (
        <p className="mt-1">Ask the owner to subscribe.</p>
      )}
    </Notice>
  );
}

/**
 * The one billing message for a page outside the till, straight from
 * `ctx.access` (`requireVendorRole`): the trial countdown in its last
 * `TRIAL_NOTICE_DAYS` days, the "orders paused" notice once locked, nothing
 * for paid and free vendors. Server-rendered per request; no timer.
 *
 *   <BillingAccessNotice
 *     access={ctx.access}
 *     isOwner={ctx.staff.role === "OWNER"}
 *     className="mx-auto mb-3 max-w-3xl"
 *   />
 */
export function BillingAccessNotice({
  access,
  isOwner,
  now = new Date(),
  className,
}: {
  access: BillingAccess;
  isOwner: boolean;
  now?: Date;
  /** Width and margins of the page's column; applied to whichever notice shows. */
  className?: string;
}) {
  if (access.kind === "trial") {
    return (
      <TrialNotice
        endsAt={access.endsAt}
        now={now}
        isOwner={isOwner}
        variant="box"
        className={className}
      />
    );
  }
  if (access.kind === "locked") return <OrdersPausedNotice isOwner={isOwner} className={className} />;
  return null;
}
