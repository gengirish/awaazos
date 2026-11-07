"use client";

import { useEffect, useState } from "react";

import { InstallBanner } from "@/components/pwa/InstallPrompt";
import { REFERRAL_PROMPT_SNOOZE_KEY, ReferralPrompt } from "@/components/referrals/ReferralPrompt";
import { SetupReminderBanner } from "@/components/setup/SetupChecklistCard";
import { StorePolishBanner } from "@/components/setup/StorePolishBanner";
import { OWNER_SURVEY_SNOOZE_KEY, OwnerSurveyPrompt } from "@/components/survey/OwnerSurveyPrompt";
import { useBannerSnooze } from "@/hooks/useBannerSnooze";
import { isInstallBannerEligible, useInstallPrompt } from "@/hooks/useInstallPrompt";
import {
  DISMISS_FOR_GOOD,
  pickOrdersBanner,
  storePolishDismissKey,
  SURVEY_SNOOZE_DAYS,
  type StorePolishNudge,
} from "@/lib/orders-banner";
import type { ReferralDelivery } from "@/lib/referral";
import type { ChecklistItem } from "@/lib/settings-overview";

const REMINDER_SNOOZE_KEY = "awz_setup_reminder_snoozed";
/** sessionStorage: the survey was already on screen in this browser session. */
const SURVEY_SEEN_KEY = "awz_owner_survey_seen";

function surveySeenThisSession(): boolean {
  try {
    return window.sessionStorage.getItem(SURVEY_SEEN_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * The orders board's one banner (rules in lib/orders-banner.ts). Each banner
 * keeps its own dismissal; dismissing one lets the next eligible one through.
 */
export function OrdersBannerSlot({
  reminder,
  polish,
  catalogue,
  askSurvey,
  askRefer,
  className,
}: {
  /** A setup reminder, when reminders are all that is left of the checklist. */
  reminder: ChecklistItem | null;
  /** The one-time store polish nudge, for an owner whose store still reads unfinished. */
  polish: StorePolishNudge | null;
  /** "menu" / "product list" (`StoreVocabulary.catalogue`). */
  catalogue: string;
  askSurvey: boolean;
  /** How a referral reward would reach this store, when the prompt is for it. */
  askRefer: ReferralDelivery | null;
  className?: string;
}) {
  const install = useInstallPrompt();
  const reminderSnooze = useBannerSnooze(REMINDER_SNOOZE_KEY);
  const polishSnooze = useBannerSnooze(storePolishDismissKey(polish?.kind ?? "no_tagline"), DISMISS_FOR_GOOD);
  const surveySnooze = useBannerSnooze(OWNER_SURVEY_SNOOZE_KEY, SURVEY_SNOOZE_DAYS);
  const referSnooze = useBannerSnooze(REFERRAL_PROMPT_SNOOZE_KEY);
  // Read once per visit to the board: a survey shown on an earlier visit this session stays away.
  const [surveyShownEarlier, setSurveyShownEarlier] = useState(true);
  useEffect(() => setSurveyShownEarlier(surveySeenThisSession()), []);

  const banner = pickOrdersBanner({
    reminder: reminder !== null && !reminderSnooze.snoozed,
    polish: polish !== null && !polishSnooze.snoozed,
    install: isInstallBannerEligible(install),
    survey: askSurvey && !surveySnooze.snoozed && !surveyShownEarlier,
    refer: askRefer !== null && !referSnooze.snoozed,
  });

  useEffect(() => {
    if (banner !== "survey") return;
    try {
      window.sessionStorage.setItem(SURVEY_SEEN_KEY, "1");
    } catch {
      // No storage: it may show again on the next visit this session, which is harmless.
    }
  }, [banner]);

  if (banner === "reminder" && reminder) {
    return <SetupReminderBanner item={reminder} onDismiss={reminderSnooze.snooze} className={className} />;
  }
  if (banner === "polish" && polish) {
    return (
      <StorePolishBanner nudge={polish} catalogue={catalogue} onDismiss={polishSnooze.snooze} className={className} />
    );
  }
  if (banner === "install") return <InstallBanner className={className} />;
  if (banner === "survey") return <OwnerSurveyPrompt className={className} />;
  if (banner === "refer" && askRefer) return <ReferralPrompt delivery={askRefer} className={className} />;
  return null;
}
