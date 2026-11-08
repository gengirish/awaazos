/**
 * Sends the alerts whose rules live in lib/trial-alerts.ts. A claim in Upstash
 * (`SET NX`) keeps each alert to one send, however often the cron fires or
 * buyers retry; a send that reached nobody gives the claim back. No KV → no
 * alert, because a repeat every day is worse than a missed one (the in-app
 * notice still shows).
 *
 * Nothing is written to Postgres. Logs carry the vendor id and counts: never an
 * email address or anything about the buyer.
 */

import { waitUntil } from "@vercel/functions";

import { sendOrderCapEmail, sendStoreLockedEmail, sendTrialReminderEmail } from "@/lib/email";
import { getKv } from "@/lib/kv";
import { logger } from "@/lib/logger";
import { billingAccess } from "@/lib/plan";
import { prisma } from "@/lib/prisma";
import { orderCapPayload, sendToVendor, storeLockedPayload } from "@/lib/push";
import { appBaseUrl } from "@/lib/storefront-razorpay";
import {
  STORE_LOCKED_KEY_TTL_SECONDS,
  TRIAL_REMINDER_FIRST_DAYS,
  TRIAL_REMINDER_KEY_TTL_SECONDS,
  istDaysUntil,
  orderCapKey,
  storeLockedKey,
  trialReminderDue,
  trialReminderKey,
} from "@/lib/trial-alerts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Ask for one IST day more than the window; `trialReminderDue` has the last word. */
const QUERY_WINDOW_DAYS = TRIAL_REMINDER_FIRST_DAYS + 1;

const OWNERS_SELECT = {
  where: { role: "OWNER", isActive: true },
  select: { name: true, userId: true, user: { select: { email: true } } },
} as const;

function billingUrl(): string {
  return `${appBaseUrl()}/settings/billing`;
}

export type TrialReminderRun = { due: number; sent: number; skipped: number; failed: number };

/** One pass of the daily job. Demo stores have no trial; paying sellers are left alone. */
export async function sendTrialReminders(now: Date = new Date()): Promise<TrialReminderRun> {
  const run: TrialReminderRun = { due: 0, sent: 0, skipped: 0, failed: 0 };
  const kv = getKv();
  if (!kv) {
    logger.warn({}, "trial_reminders.no_kv");
    return run;
  }

  const vendors = await prisma.vendor.findMany({
    where: {
      isActive: true,
      isDemo: false,
      trialEndsAt: { gt: now, lte: new Date(now.getTime() + QUERY_WINDOW_DAYS * DAY_MS) },
    },
    select: {
      id: true,
      name: true,
      plan: true,
      planExpiresAt: true,
      trialEndsAt: true,
      customPricePaise: true,
      staff: OWNERS_SELECT,
    },
  });

  for (const vendor of vendors) {
    const access = billingAccess(vendor, now);
    if (access.kind !== "trial") continue;
    const kind = trialReminderDue(access.endsAt, now);
    if (!kind) continue;
    run.due += 1;

    const key = trialReminderKey(vendor.id, kind, access.endsAt);
    try {
      const claimed = await kv.set(key, "1", { nx: true, ex: TRIAL_REMINDER_KEY_TTL_SECONDS });
      if (claimed === null) {
        run.skipped += 1;
        continue;
      }

      let delivered = 0;
      for (const owner of vendor.staff) {
        if (!owner.user.email) continue;
        const res = await sendTrialReminderEmail({
          to: owner.user.email,
          name: owner.name,
          storeName: vendor.name,
          endsAt: access.endsAt,
          daysLeft: istDaysUntil(access.endsAt, now),
          billingUrl: billingUrl(),
          customPricePaise: vendor.customPricePaise,
        });
        if (res.delivered) delivered += 1;
      }

      if (delivered > 0) {
        run.sent += 1;
      } else {
        // Reached nobody: tomorrow's run tries again.
        run.failed += 1;
        await kv.del(key);
      }
    } catch (err) {
      run.failed += 1;
      logger.error({ vendorId: vendor.id, err: err instanceof Error ? err.name : "unknown" }, "trial_reminders.failed");
    }
  }

  logger.info(run, "trial_reminders.done");
  return run;
}

/**
 * A buyer's order was just refused because the store is locked. Tell the owners
 * by push and email, at most once a day. Never throws. Nothing about the buyer
 * goes in the alert.
 */
export async function alertSellerStoreLocked(vendorId: string): Promise<void> {
  const kv = getKv();
  if (!kv) return;
  const key = storeLockedKey(vendorId);
  try {
    const claimed = await kv.set(key, "1", { nx: true, ex: STORE_LOCKED_KEY_TTL_SECONDS });
    if (claimed === null) return;

    const vendor = await prisma.vendor.findFirst({
      where: { id: vendorId },
      select: { name: true, customPricePaise: true, staff: OWNERS_SELECT },
    });

    let reached = 0;
    for (const owner of vendor?.staff ?? []) {
      const push = await sendToVendor(vendorId, storeLockedPayload(), { userId: owner.userId }).catch(() => null);
      reached += push?.sent ?? 0;
      if (!owner.user.email) continue;
      const email = await sendStoreLockedEmail({
        to: owner.user.email,
        name: owner.name,
        storeName: vendor!.name,
        billingUrl: billingUrl(),
        customPricePaise: vendor!.customPricePaise,
      });
      if (email.delivered) reached += 1;
    }

    if (reached === 0) await kv.del(key);
    logger.info({ vendorId, reached }, "store_locked_alert.done");
  } catch (err) {
    logger.error({ vendorId, err: err instanceof Error ? err.name : "unknown" }, "store_locked_alert.failed");
  }
}

/**
 * A buyer's order was just refused by the monthly order cap. Same rules as the
 * locked alert: owners only, once a day, never throws, nothing about the buyer.
 */
export async function alertSellerOrderCap(vendorId: string): Promise<void> {
  const kv = getKv();
  if (!kv) return;
  const key = orderCapKey(vendorId);
  try {
    const claimed = await kv.set(key, "1", { nx: true, ex: STORE_LOCKED_KEY_TTL_SECONDS });
    if (claimed === null) return;

    const vendor = await prisma.vendor.findFirst({
      where: { id: vendorId },
      select: { name: true, staff: OWNERS_SELECT },
    });

    let reached = 0;
    for (const owner of vendor?.staff ?? []) {
      const push = await sendToVendor(vendorId, orderCapPayload(), { userId: owner.userId }).catch(() => null);
      reached += push?.sent ?? 0;
      if (!owner.user.email) continue;
      const email = await sendOrderCapEmail({
        to: owner.user.email,
        name: owner.name,
        storeName: vendor!.name,
        billingUrl: billingUrl(),
      });
      if (email.delivered) reached += 1;
    }

    if (reached === 0) await kv.del(key);
    logger.info({ vendorId, reached }, "order_cap_alert.done");
  } catch (err) {
    logger.error({ vendorId, err: err instanceof Error ? err.name : "unknown" }, "order_cap_alert.failed");
  }
}

function inBackground(p: Promise<void>): void {
  try {
    waitUntil(p);
  } catch {
    // Outside a Vercel request context the promise still runs to completion.
  }
}

/** For the buyer's request: the buyer never waits on this. */
export function alertSellerStoreLockedInBackground(vendorId: string): void {
  inBackground(alertSellerStoreLocked(vendorId));
}

/** For the buyer's request: the buyer never waits on this. */
export function alertSellerOrderCapInBackground(vendorId: string): void {
  inBackground(alertSellerOrderCap(vendorId));
}
