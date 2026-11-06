"use client";

import { InstallBanner } from "@/components/pwa/InstallPrompt";
import { REFERRAL_PROMPT_SNOOZE_KEY, ReferralPrompt } from "@/components/referrals/ReferralPrompt";
import { SetupReminderBanner } from "@/components/setup/SetupChecklistCard";
import { OWNER_SURVEY_SNOOZE_KEY, OwnerSurveyPrompt } from "@/components/survey/OwnerSurveyPrompt";
import { useBannerSnooze } from "@/hooks/useBannerSnooze";
import { isInstallBannerEligible, useInstallPrompt } from "@/hooks/useInstallPrompt";
import { pickOrdersBanner } from "@/lib/orders-banner";
import type { ReferralDelivery } from "@/lib/referral";
import type { ChecklistItem } from "@/lib/settings-overview";

const REMINDER_SNOOZE_KEY = "awz_setup_reminder_snoozed";

/**
 * The orders board's one banner (rules in lib/orders-banner.ts). Each banner
 * keeps its own dismissal; dismissing one lets the next eligible one through.
 */
export function OrdersBannerSlot({
  reminder,
  askSurvey,
  askRefer,
  className,
}: {
  /** A setup reminder, when reminders are all that is left of the checklist. */
  reminder: ChecklistItem | null;
  askSurvey: boolean;
  /** How a referral reward would reach this store, when the prompt is for it. */
  askRefer: ReferralDelivery | null;
  className?: string;
}) {
  const install = useInstallPrompt();
  const reminderSnooze = useBannerSnooze(REMINDER_SNOOZE_KEY);
  const surveySnooze = useBannerSnooze(OWNER_SURVEY_SNOOZE_KEY);
  const referSnooze = useBannerSnooze(REFERRAL_PROMPT_SNOOZE_KEY);

  const banner = pickOrdersBanner({
    reminder: reminder !== null && !reminderSnooze.snoozed,
    install: isInstallBannerEligible(install),
    survey: askSurvey && !surveySnooze.snoozed,
    refer: askRefer !== null && !referSnooze.snoozed,
  });

  if (banner === "reminder" && reminder) {
    return <SetupReminderBanner item={reminder} onDismiss={reminderSnooze.snooze} className={className} />;
  }
  if (banner === "install") return <InstallBanner className={className} />;
  if (banner === "survey") return <OwnerSurveyPrompt className={className} />;
  if (banner === "refer" && askRefer) return <ReferralPrompt delivery={askRefer} className={className} />;
  return null;
}
