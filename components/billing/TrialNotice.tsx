import Link from "next/link";

import { formatIstDate } from "@/lib/datetime";
import { trialDaysLeft } from "@/lib/plan";

/** Days before the trial ends at which selling screens start showing the notice. */
export const TRIAL_NOTICE_DAYS = 5;

/**
 * "Trial ends in N days" strip for selling screens. Rendered on the server per
 * request from `trialEndsAt` — no timer. Returns null outside the last
 * `TRIAL_NOTICE_DAYS` days.
 */
export function TrialNotice({ endsAt, now, isOwner }: { endsAt: Date; now: Date; isOwner: boolean }) {
  const days = trialDaysLeft(endsAt, now);
  if (days > TRIAL_NOTICE_DAYS) return null;
  const when = days <= 1 ? "today" : `in ${days} days`;
  return (
    <div
      role="status"
      className="mx-auto flex max-w-lg flex-wrap items-center justify-between gap-2 border-b bg-amber-50 px-4 py-2 text-sm text-amber-950 md:max-w-6xl dark:bg-amber-950 dark:text-amber-50"
    >
      <span>
        <strong className="font-semibold">Free trial ends {when}</strong> ({formatIstDate(endsAt)}). Subscribe to
        keep selling after that.
      </span>
      {isOwner ? (
        <Link
          href="/settings/billing"
          className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4"
        >
          Choose a plan
        </Link>
      ) : null}
    </div>
  );
}
