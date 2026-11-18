import { Star } from "lucide-react";
import type { Metadata } from "next";

import { SettingsCard, SettingsPageHeader } from "@/components/settings/SettingsChrome";
import { settingsSection } from "@/components/settings/sections";
import { EmptyState } from "@/components/ui/empty-state";
import { formatIstDate } from "@/lib/drops-time";
import { formatAverageRating, PUBLIC_RATING_MIN, RATING_WORDS, ratingCountLabel } from "@/lib/order-feedback";
import { loadRatingSummary } from "@/lib/order-feedback-server";
import { prisma } from "@/lib/prisma";

import { requireSettingsContext } from "../_context";
import { BRAND_NAME } from "@/lib/brand";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: `Customer feedback · Settings · ${BRAND_NAME}` };

const SHOWN = 50;

/**
 * Settings → Customer feedback (any staff): the store's average and its latest
 * ratings. The orders board only keeps recent orders, so a rating on an older
 * one lands here. Rules in lib/order-feedback.ts.
 */
export default async function FeedbackSettingsPage() {
  const { vendor } = await requireSettingsContext();
  const section = settingsSection("feedback");
  const [summary, rows] = await Promise.all([
    loadRatingSummary(vendor.id),
    prisma.orderFeedback.findMany({
      where: { vendorId: vendor.id },
      orderBy: { createdAt: "desc" },
      take: SHOWN,
      select: {
        id: true,
        rating: true,
        comment: true,
        createdAt: true,
        transaction: { select: { billNumber: true, customerName: true } },
      },
    }),
  ]);
  const toGo = PUBLIC_RATING_MIN - summary.count;

  return (
    <>
      <SettingsPageHeader title={section.title} description="What customers said after they got their order." />
      {summary.count === 0 ? (
        <EmptyState
          icon={Star}
          title="No ratings yet"
          description="Customers can rate an order on their order page once you mark it delivered or picked up."
        />
      ) : (
        <div className="space-y-4">
          <SettingsCard title="Your rating">
            <p className="font-display text-3xl font-bold">
              {formatAverageRating(summary)} <span className="text-base font-semibold">out of 5</span>
            </p>
            <p className="text-sm text-muted-foreground">{ratingCountLabel(summary.count)}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {toGo > 0
                ? `Your store page shows your average once you have ${PUBLIC_RATING_MIN} ratings. ${toGo} to go.`
                : "Your store page shows this average. Comments and names are only shown to you."}
            </p>
          </SettingsCard>
          <SettingsCard title={summary.count > SHOWN ? `Latest ${SHOWN}` : "All ratings"}>
            <ul className="divide-y">
              {rows.map((r) => (
                <li key={r.id} className="py-3 first:pt-0 last:pb-0">
                  <p className="flex flex-wrap items-center gap-x-2 text-sm font-semibold">
                    <Star className="h-4 w-4 shrink-0 fill-primary text-primary" aria-hidden />
                    {r.rating} of 5 · {RATING_WORDS[r.rating - 1]}
                  </p>
                  {r.comment ? <p className="mt-1 whitespace-pre-wrap break-words text-sm">{r.comment}</p> : null}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {r.transaction.customerName?.trim() || "Customer"} · {formatIstDate(r.createdAt)} ·{" "}
                    <span className="font-mono">{r.transaction.billNumber}</span>
                  </p>
                </li>
              ))}
            </ul>
          </SettingsCard>
        </div>
      )}
    </>
  );
}
