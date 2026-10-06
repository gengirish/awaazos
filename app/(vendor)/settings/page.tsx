import { CheckCircle2, ChevronRight, CircleDashed, ListChecks, MinusCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { LegacyAnchorRedirect } from "@/components/settings/LegacyAnchorRedirect";
import { SETTINGS_SECTIONS, type SettingsSectionId } from "@/components/settings/sections";
import { prisma } from "@/lib/prisma";
import {
  ordersStatus,
  paymentsStatus,
  planStatus,
  setupChecklist,
  storeStatus,
  voiceStatus,
  type SectionStatus,
  type SettingsSnapshot,
} from "@/lib/settings-overview";
import { hasStoredRazorpayCreds } from "@/lib/storefront-razorpay";

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
  const { vendor } = await requireSettingsContext();

  const [settings, availableItemCount] = await Promise.all([
    prisma.vendorSettings.findUnique({
      where: { vendorId: vendor.id },
      select: {
        voiceLang: true,
        publishStorefront: true,
        acceptPayOnDelivery: true,
        acceptMenuOrders: true,
        menuFulfilmentMode: true,
        // Presence only — the encrypted secrets never leave this server component.
        razorpayKeyId: true,
        razorpayKeySecretEnc: true,
        razorpayWebhookSecretEnc: true,
      },
    }),
    prisma.menuItem.count({ where: { vendorId: vendor.id, isAvailable: true } }),
  ]);

  const snapshot: SettingsSnapshot = {
    slug: vendor.slug,
    publishStorefront: settings?.publishStorefront ?? false,
    acceptMenuOrders: settings?.acceptMenuOrders ?? false,
    menuFulfilmentMode: settings?.menuFulfilmentMode ?? "PICKUP",
    upiId: vendor.upiId,
    acceptPayOnDelivery: settings?.acceptPayOnDelivery ?? true,
    razorpayConfigured: hasStoredRazorpayCreds(settings),
    voiceLang: settings?.voiceLang ?? "en-IN",
    plan: vendor.plan,
    availableItemCount,
  };

  const statuses: Record<SettingsSectionId, SectionStatus> = {
    store: storeStatus(snapshot),
    orders: ordersStatus(snapshot),
    payments: paymentsStatus(snapshot),
    voice: voiceStatus(snapshot),
    billing: planStatus(snapshot),
  };
  const checklist = setupChecklist(snapshot);

  return (
    <>
      <LegacyAnchorRedirect />
      <header className="mb-4">
        <h1 className="font-display text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your stall, online store and plan.</p>
      </header>

      {checklist.length > 0 ? (
        <section
          aria-labelledby="setup-checklist-heading"
          className="mb-4 rounded-lg border border-amber-500/60 bg-amber-50 p-4 text-amber-950 dark:bg-amber-950/40 dark:text-amber-50"
        >
          <h2 id="setup-checklist-heading" className="flex items-center gap-2 font-display text-base font-semibold">
            <ListChecks className="h-5 w-5" aria-hidden="true" />
            Setup checklist: start taking online orders
          </h2>
          <ul className="mt-2 space-y-1">
            {checklist.map((item) => (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className="flex min-h-11 items-center justify-between gap-3 rounded-md px-2 text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex items-center gap-2">
                    <CircleDashed className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {item.text}
                  </span>
                  <span className="sr-only">{item.linkText}</span>
                  <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <nav aria-label="Settings sections">
        <ul className="divide-y divide-border overflow-hidden rounded-lg border bg-card">
          {SETTINGS_SECTIONS.map((section) => {
            const Icon = section.icon;
            return (
              <li key={section.id}>
                <Link
                  href={section.href}
                  className="flex min-h-14 items-center gap-3 px-4 py-3 ring-inset transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-foreground">{section.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{section.description}</span>
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
      </nav>
    </>
  );
}
