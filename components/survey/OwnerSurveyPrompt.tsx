"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { useBannerSnooze } from "@/hooks/useBannerSnooze";
import { SURVEY_SNOOZE_DAYS } from "@/lib/orders-banner";
import { cn } from "@/lib/utils";

/** Holds the time of the last "Not now" (lib/orders-banner.ts). */
export const OWNER_SURVEY_SNOOZE_KEY = "awz_owner_survey_prompt_hidden";

/**
 * Asks an owner who hasn't answered to take the survey, on the orders board
 * only. The server decides who sees it (`shouldAskOwnerSurvey`); "Not now"
 * snoozes it on this device for `SURVEY_SNOOZE_DAYS`, it shows once per browser
 * session (OrdersBannerSlot), and Settings and Help still list the survey.
 */
export function OwnerSurveyPrompt({ className }: { className?: string }) {
  const { snoozed, snooze } = useBannerSnooze(OWNER_SURVEY_SNOOZE_KEY, SURVEY_SNOOZE_DAYS);
  if (snoozed) return null;
  return (
    <aside
      aria-label="Owner survey"
      className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-card px-4 py-2 shadow-xs", className)}
    >
      <div className="min-w-0 flex-1 basis-64">
        <p className="font-medium text-foreground">What should we build for your store?</p>
        <p className="text-sm text-muted-foreground">Tell us what is hard right now. It takes about a minute.</p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button asChild>
          <Link href="/settings/survey">Answer now</Link>
        </Button>
        <Button type="button" variant="ghost" onClick={snooze}>
          Not now
        </Button>
      </div>
    </aside>
  );
}
