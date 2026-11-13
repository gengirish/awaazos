import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ReferralShareClient } from "@/components/settings/ReferralShareClient";
import { SettingsCard, SettingsPageHeader } from "@/components/settings/SettingsChrome";
import { settingsSection } from "@/components/settings/sections";
import { TRIAL_DAYS } from "@/lib/constants";
import { REFERRAL_REWARD_CAP_PER_YEAR, REFERRED_TRIAL_DAYS, referralSignUpUrl, rewardMonthsFor } from "@/lib/referral";
import { loadReferralSummary } from "@/lib/referral-server";
import { appBaseUrl } from "@/lib/storefront-razorpay";
import { prisma } from "@/lib/prisma";
import { LIVE_SUBSCRIPTION_STATUSES } from "@/lib/subscription";

import { requireSettingsContext } from "../_context";
import { BRAND_NAME } from "@/lib/brand";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: `Refer a seller · Settings · ${BRAND_NAME}` };

function months(n: number): string {
  return `${n} ${n === 1 ? "month" : "months"}`;
}

/**
 * Settings → Refer a seller (OWNER, not on a demo store). Rules in the header
 * of lib/referral.ts. Counts only (`ReferralSummary`): never the invited
 * stores' names or contact details.
 */
export default async function ReferSettingsPage() {
  const { vendor, isOwner } = await requireSettingsContext();
  // Other staff and demo stores don't see this section; send them to the overview.
  if (!isOwner || vendor.isDemo) redirect("/settings");

  const [summary, settings] = await Promise.all([
    loadReferralSummary(vendor),
    prisma.vendorSettings.findUnique({ where: { vendorId: vendor.id }, select: { razorpaySubStatus: true } }),
  ]);
  const hasLiveSubscription = LIVE_SUBSCRIPTION_STATUSES.includes(settings?.razorpaySubStatus ?? "");
  const link = referralSignUpUrl(appBaseUrl(), vendor.slug);
  const section = settingsSection("refer");
  const monthly = rewardMonthsFor("monthly");
  const yearly = rewardMonthsFor("yearly");

  const counts: { label: string; value: string }[] = [
    { label: "Stores signed up", value: String(summary.signedUp) },
    { label: "Stores subscribed", value: String(summary.paid) },
    { label: "Free months applied", value: String(summary.monthsRedeemed) },
    { label: "Free months saved for later", value: String(summary.monthsBanked) },
    { label: "Free months you can still earn this year", value: String(summary.monthsLeftThisYear) },
  ];

  return (
    <>
      <SettingsPageHeader
        title={section.title}
        description="Know another seller who takes orders on Instagram or WhatsApp? Invite them: they get a longer free trial, and you get free months when they subscribe."
      />
      <div className="space-y-4">
        <SettingsCard title="How it works">
          <ol className="list-decimal space-y-2 pl-5 text-sm text-foreground">
            <li>Share your link with another seller: on WhatsApp, in an Instagram story, or copy it anywhere.</li>
            <li>
              They sign up with it and get {REFERRED_TRIAL_DAYS} days free instead of {TRIAL_DAYS}.
            </li>
            <li>
              When they pay for their first subscription, you get {months(monthly)} free ({yearly} if they pay
              yearly), up to {REFERRAL_REWARD_CAP_PER_YEAR} free months a year.
            </li>
          </ol>
          <p className="mt-3 text-sm text-muted-foreground">
            If you are on your free trial or your plan has ended, free months are added straight away. If you have
            a subscription, you are charged as usual and a free month is refunded from your next charge: all of it
            on a monthly plan, a twelfth of it for each free month on a yearly plan. Refunds reach you in 5 to 7
            days. Rewards are never paid out as cash.
          </p>
        </SettingsCard>

        <SettingsCard title="Your link" description="Anyone who signs up with this link is counted as your invite.">
          <ReferralShareClient link={link} storeName={vendor.name} />
        </SettingsCard>

        <SettingsCard title="Your invites">
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {counts.map((c) => (
              <div key={c.label} className="rounded-md border border-border px-3 py-2">
                <dt className="text-sm text-muted-foreground">{c.label}</dt>
                <dd className="font-display text-2xl font-semibold text-foreground">{c.value}</dd>
              </div>
            ))}
          </dl>
          {summary.monthsBanked > 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              {months(summary.monthsBanked)} saved:{" "}
              {hasLiveSubscription
                ? "they are refunded from your next charge."
                : `they are used the next time you subscribe on ${settingsSection("billing").title}.`}
            </p>
          ) : null}
        </SettingsCard>
      </div>
    </>
  );
}
