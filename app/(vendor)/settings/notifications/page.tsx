import { BellRing, CreditCard, LockKeyhole, MousePointerClick } from "lucide-react";
import type { Metadata } from "next";

import { PushAlertsButton } from "@/components/push/PushAlertsButton";
import { PushDevicesClient } from "@/components/settings/PushDevicesClient";
import { SettingsCard, SettingsPageHeader } from "@/components/settings/SettingsChrome";
import { VoiceAlertToggle } from "@/components/settings/VoiceAlertToggle";

import { requireSettingsContext } from "../_context";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Notifications · Settings · AwaazOS" };

const WHAT_YOU_GET = [
  { icon: BellRing, text: "A new order from your online store or a drop." },
  { icon: CreditCard, text: "A payment to check, when a customer sends a UPI reference." },
  { icon: MousePointerClick, text: "Tap the alert to open your orders board." },
  { icon: LockKeyhole, text: "No customer names or numbers on your lock screen — only the bill number and amount." },
] as const;

export default async function NotificationsSettingsPage() {
  // Any staff member may opt in their own phone; the context only checks sign-in.
  await requireSettingsContext();

  return (
    <>
      <SettingsPageHeader
        title="Notifications"
        description="Get an alert on your phone when an order comes in, even when the screen is locked."
      />
      <div className="space-y-4">
        <SettingsCard title="This phone">
          <PushAlertsButton variant="settings" />
        </SettingsCard>

        <SettingsCard title="Voice alert" description="Hear new orders spoken aloud while you cook.">
          <VoiceAlertToggle />
        </SettingsCard>

        <SettingsCard title="Your devices" description="Phones and browsers where you get alerts for this stall.">
          <PushDevicesClient />
        </SettingsCard>

        <SettingsCard title="What you'll get">
          <ul className="space-y-2 text-sm">
            {WHAT_YOU_GET.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-2">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </SettingsCard>
      </div>
    </>
  );
}
