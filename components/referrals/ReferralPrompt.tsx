"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { useBannerSnooze } from "@/hooks/useBannerSnooze";
import { referralPitch, type ReferralDelivery } from "@/lib/referral";
import { cn } from "@/lib/utils";

/** Holds the time of the last "Not now" (lib/orders-banner.ts). */
export const REFERRAL_PROMPT_SNOOZE_KEY = "awz_referral_prompt_hidden";

/**
 * Tells an owner they can earn free months. The server decides who sees it
 * (`shouldAskToRefer`); "Not now" snoozes it on this device for 7 days, and
 * Settings still lists the program.
 */
export function ReferralPrompt({ delivery, className }: { delivery: ReferralDelivery; className?: string }) {
  const { snoozed, snooze } = useBannerSnooze(REFERRAL_PROMPT_SNOOZE_KEY);
  if (snoozed) return null;
  return (
    <aside
      aria-label="Refer a seller"
      className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-card px-4 py-2 shadow-xs", className)}
    >
      <div className="min-w-0 flex-1 basis-64">
        <p className="font-medium text-foreground">Earn free months</p>
        <p className="text-sm text-muted-foreground">{referralPitch(delivery)}</p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button asChild>
          <Link href="/settings/refer">Invite a seller</Link>
        </Button>
        <Button type="button" variant="ghost" onClick={snooze}>
          Not now
        </Button>
      </div>
    </aside>
  );
}
