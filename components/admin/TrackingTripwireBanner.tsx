"use client";

import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { useBannerSnooze } from "@/hooks/useBannerSnooze";
import { ADMIN_METRICS_CONFIG } from "@/lib/admin-metrics-config";

/**
 * "Possible tracking issue" for one fired tripwire (lib/admin-tripwires.ts).
 * Dismissing hides it on this device for `tripwireSnoozeDays`; it comes back
 * after that if the check still fires.
 */
export function TrackingTripwireBanner({ id, title, explanation }: { id: string; title: string; explanation: string }) {
  const { snoozed, snooze } = useBannerSnooze(`awz-admin-tripwire-${id}`, ADMIN_METRICS_CONFIG.tripwireSnoozeDays);
  if (snoozed) return null;
  return (
    <Notice tone="warning" icon>
      <p className="font-semibold">Possible tracking issue: {title}</p>
      <p className="mt-1">{explanation}</p>
      <Button type="button" variant="outline" size="sm" className="mt-2" onClick={snooze}>
        Hide for {ADMIN_METRICS_CONFIG.tripwireSnoozeDays} days
      </Button>
    </Notice>
  );
}
