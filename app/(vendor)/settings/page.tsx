import { CheckCircle2, ChevronRight, CircleDashed, MinusCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { VendorSignOutButton } from "@/components/auth/VendorSignOutButton";
import { LegacyAnchorRedirect } from "@/components/settings/LegacyAnchorRedirect";
import { settingsGroupsFor, settingsSectionsFor, type SettingsSectionId } from "@/components/settings/sections";
import { SetupChecklistCard } from "@/components/setup/SetupChecklistCard";
import { trialDaysLeft } from "@/lib/plan";
import { prisma } from "@/lib/prisma";
import { isPushConfigured } from "@/lib/push";
import { countVendorPushDevices } from "@/lib/push-devices";
import {
  checklistForRole,
  notificationsStatus,
  ordersStatus,
  paymentsStatus,
  planStatus,
  receiptsStatus,
  feedbackStatus,
  referStatus,
  setupChecklist,
  storeStatus,
  surveyStatus,
  offersStatus,
  voiceStatus,
  type SectionStatus,
  type SettingsSnapshot,
} from "@/lib/settings-overview";
import { loadRatingSummary } from "@/lib/order-feedback-server";
import { loadSurveyAnswers } from "@/lib/owner-survey-server";
import { loadReferralSummary } from "@/lib/referral-server";
import { fillVocabulary } from "@/lib/store-vocabulary";
import { hasStoredRazorpayCreds, RAZORPAY_CRED_SELECT } from "@/lib/storefront-razorpay";

import { requireSettingsContext } from "./_context";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Settings · AwaazOS" };

function StatusLine({ status }: { status: SectionStatus }) {
  if (status.parts) {
    return (
      <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        {status.parts.map((p, i) => (
          <span key={p.label} className="inline-flex items-center gap-1 whitespace-nowrap">
            {p.label}
            {p.on ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-green-700 dark:text-green-500" aria-hidden="true" />
            ) : (
              <MinusCircle className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            )}
            <span className="sr-only">{p.on ? "on" : "off"}</span>
            {i < status.parts!.length - 1 ? (
              <span aria-hidden="true" className="text-muted-foreground">
                ·
              </span>
            ) : null}
          </span>
        ))}
      </span>
    );
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      {status.on ? (
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-700 dark:text-green-500" aria-hidden="true" />
      ) : (
        <CircleDashed className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
      <span className="truncate">{status.text}</span>
    </span>
  );
}

export default async function SettingsHubPage() {
  const { vendor, user, access, isOwner, canManage, storeKind, vocab } = await requireSettingsContext();

  const pushConfigured = isPushConfigured();
  const sections = settingsSectionsFor({ isOwner, isDemo: vendor.isDemo });
  const showRefer = sections.some((s) => s.id === "refer");
  const showSurvey = sections.some((s) => s.id === "survey");
  const [settings, availableItemCount, pushDeviceCount, activeOfferCount, dropCount, referral, ratings, surveyAnswers] = await Promise.all([
    prisma.vendorSettings.findUnique({
      where: { vendorId: vendor.id },
      select: {
        voiceLang: true,
        publishStorefront: true,
        acceptPayOnDelivery: true,
        acceptMenuOrders: true,
        menuFulfilmentMode: true,
        fssaiNumber: true,
        receiptPaper: true,
        autoPrintReceipt: true,
        // Presence only — the encrypted secrets never leave this server component.
        ...RAZORPAY_CRED_SELECT,
      },
    }),
    prisma.menuItem.count({ where: { vendorId: vendor.id, isAvailable: true } }),
    pushConfigured ? countVendorPushDevices(vendor.id) : Promise.resolve(0),
    prisma.offer.count({ where: { vendorId: vendor.id, isActive: true } }),
    prisma.drop.count({ where: { vendorId: vendor.id } }),
    showRefer ? loadReferralSummary(vendor) : Promise.resolve(null),
    loadRatingSummary(vendor.id),
    showSurvey ? loadSurveyAnswers(vendor.id) : Promise.resolve(null),
  ]);

  const snapshot: SettingsSnapshot = {
    slug: vendor.slug,
    publishStorefront: settings?.publishStorefront ?? false,
    acceptMenuOrders: settings?.acceptMenuOrders ?? false,
    menuFulfilmentMode: settings?.menuFulfilmentMode ?? "PICKUP",
    upiId: vendor.upiId,
    acceptPayOnDelivery: settings?.acceptPayOnDelivery ?? true,
    fssaiNumber: settings?.fssaiNumber ?? null,
    razorpayConfigured: hasStoredRazorpayCreds(settings),
    voiceLang: settings?.voiceLang ?? "en-IN",
    plan: vendor.plan,
    billing:
      access.kind === "trial"
        ? { kind: "trial", daysLeft: trialDaysLeft(access.endsAt) }
        : access.kind === "locked"
          ? { kind: "locked" }
          : undefined,
    availableItemCount,
    dropCount,
    pushConfigured,
    pushDeviceCount,
  };

  const statuses: Record<SettingsSectionId, SectionStatus> = {
    store: storeStatus(snapshot),
    orders: ordersStatus(snapshot, storeKind),
    feedback: feedbackStatus(ratings),
    offers: offersStatus(activeOfferCount),
    payments: paymentsStatus(snapshot),
    receipts: receiptsStatus({
      receiptPaper: settings?.receiptPaper ?? "MM80",
      autoPrintReceipt: settings?.autoPrintReceipt ?? false,
      gstin: vendor.gstin,
    }),
    notifications: notificationsStatus(snapshot),
    voice: voiceStatus(snapshot),
    billing: planStatus(snapshot),
    refer: referral ? referStatus(referral) : { text: "", on: false },
    survey: surveyStatus(surveyAnswers !== null),
  };
  // Same rule and card as /orders and /pos: only steps this role can act on.
  const checklist = checklistForRole(
    setupChecklist(snapshot, storeKind),
    isOwner ? "OWNER" : canManage ? "MANAGER" : "CASHIER",
  );

  return (
    <>
      <LegacyAnchorRedirect />
      <header className="mb-4">
        <h1 className="font-display text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your store, payments and plan.</p>
      </header>

      <SetupChecklistCard
        items={checklist}
        store={snapshot.publishStorefront ? { slug: vendor.slug, name: vendor.name } : null}
        className="mb-4"
      />

      <nav aria-label="Settings sections" className="space-y-6">
        {settingsGroupsFor(sections).map((group) => (
          <div key={group.title}>
            <h2 className="mb-2 font-display text-base font-semibold text-foreground">{group.title}</h2>
            <ul className="divide-y divide-border overflow-hidden rounded-lg border bg-card">
              {group.sections.map((section) => {
                const Icon = section.icon;
                return (
                  <li key={section.id}>
                    <Link
                      href={section.href}
                      className="flex min-h-14 items-center gap-3 px-4 py-3 ring-inset transition-colors hover:bg-muted/50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold text-foreground">{section.title}</span>
                        <span className="hidden truncate text-xs text-muted-foreground sm:block">{fillVocabulary(section.description, vocab)}</span>
                        <span className="mt-0.5 block text-sm text-muted-foreground">
                          <StatusLine status={statuses[section.id]} />
                        </span>
                      </span>
                      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <section aria-labelledby="account-heading" className="mt-6">
        <h2 id="account-heading" className="mb-2 font-display text-base font-semibold text-foreground">
          Account
        </h2>
        <div className="overflow-hidden rounded-lg border bg-card">
          <p className="border-b border-border px-4 py-3 text-sm text-muted-foreground">
            Signed in as{" "}
            <span className="break-all font-semibold text-foreground">{user.name?.trim() || user.email}</span>
            {user.name?.trim() && user.email ? <span className="block break-all">{user.email}</span> : null}
          </p>
          <VendorSignOutButton variant="row" vendorId={vendor.id} storeName={vendor.name} />
        </div>
      </section>
    </>
  );
}
