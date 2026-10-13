/**
 * Pure helpers for the vendor-side Drop builder (list, form, duplicate, item
 * sync). Client-safe: no Prisma, no Node built-ins — the drops pages import
 * these directly. Type-only imports from server modules are erased at build.
 */

import type { EffectiveDropStatus } from "@/lib/drops";
import { dbDateToYmd, utcToIstParts } from "@/lib/drops-time";
import type { DropUpsertInput } from "@/lib/zod-drops";

const DAY_MS = 86_400_000;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

function ymdToUtcMidnightMs(ymd: string): number {
  if (!YMD.test(ymd)) throw new Error(`Invalid date: ${ymd}`);
  const ms = Date.parse(`${ymd}T00:00:00.000Z`);
  if (Number.isNaN(ms)) throw new Error(`Invalid date: ${ymd}`);
  return ms;
}

/** Today's calendar day in IST, "YYYY-MM-DD". */
export function istTodayYmd(now: Date = new Date()): string {
  return utcToIstParts(now).ymd;
}

/** "2026-10-05" + 1 → "2026-10-06". Calendar arithmetic, no time zone involved. */
export function addDaysYmd(ymd: string, days: number): string {
  return new Date(ymdToUtcMidnightMs(ymd) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Tomorrow in IST — the target of "Copy for tomorrow". */
export function istTomorrowYmd(now: Date = new Date()): string {
  return addDaysYmd(istTodayYmd(now), 1);
}

/** Whole days from a stored cooking day (@db.Date, midnight UTC) to a target IST day. */
export function dayOffset(fromDbDate: Date, toYmd: string): number {
  const diff = ymdToUtcMidnightMs(toYmd) - fromDbDate.getTime();
  if (diff % DAY_MS !== 0) throw new Error("Stored drop date is not a calendar day");
  return diff / DAY_MS;
}

/** Whole calendar days from `fromYmd` to `toYmd` (negative when `toYmd` is earlier). */
export function daysBetweenYmd(fromYmd: string, toYmd: string): number {
  return (ymdToUtcMidnightMs(toYmd) - ymdToUtcMidnightMs(fromYmd)) / DAY_MS;
}

/** True for a real calendar day in "YYYY-MM-DD" form. */
export function isValidYmd(ymd: string): boolean {
  try {
    ymdToUtcMidnightMs(ymd);
    return true;
  } catch {
    return false;
  }
}

/** Usual cut-off: the evening before the cooking day. */
export const DEFAULT_CUTOFF_TIME = "21:00";
/** Fallback when the evening before is (nearly) gone: the cooking-day morning. */
export const LATE_CUTOFF_TIME = "10:00";
/** From this IST time on the evening before, a 21:00 cut-off leaves buyers too little time. */
const LATE_EVENING_HM = "20:00";

/**
 * Default order cut-off for a drop cooked on `cookingYmd`: the day before at
 * 21:00 IST. If that evening has already passed — or it is today and already
 * past 20:00 IST — fall back to the cooking day itself at 10:00.
 */
export function defaultCutoffFor(
  cookingYmd: string,
  now: Date = new Date(),
): { closesAtDate: string; closesAtTime: string } {
  const dayBefore = addDaysYmd(cookingYmd, -1);
  const { ymd: today, hm: nowHm } = utcToIstParts(now);
  const tooLate = today > dayBefore || (today === dayBefore && nowHm >= LATE_EVENING_HM);
  return tooLate
    ? { closesAtDate: cookingYmd, closesAtTime: LATE_CUTOFF_TIME }
    : { closesAtDate: dayBefore, closesAtTime: DEFAULT_CUTOFF_TIME };
}

/**
 * The cooking day moved from `prevDate` to `nextDate`: move the order window's
 * dates by the same number of days, so a drop rescheduled from Thursday to
 * Saturday doesn't keep a Wednesday cut-off. A date the vendor edited by hand
 * (`touched`) is left alone, as is everything when either cooking day isn't a
 * valid "YYYY-MM-DD" (e.g. the date input was cleared mid-edit).
 */
export function shiftOrderWindowDates<T extends { closesAtDate: string; opensAtDate: string }>(
  window: T,
  prevDate: string,
  nextDate: string,
  touched: { closesAtDate: boolean; opensAtDate: boolean },
): T {
  if (!isValidYmd(prevDate) || !isValidYmd(nextDate)) return window;
  const delta = daysBetweenYmd(prevDate, nextDate);
  if (delta === 0) return window;
  const move = (ymd: string, isTouched: boolean) =>
    isTouched || !isValidYmd(ymd) ? ymd : addDaysYmd(ymd, delta);
  return {
    ...window,
    closesAtDate: move(window.closesAtDate, touched.closesAtDate),
    opensAtDate: move(window.opensAtDate, touched.opensAtDate),
  };
}

/** Days between the order cut-off and the cooking day (1 = the day before), or null if either is invalid. */
export function cutoffLeadDays(cookingYmd: string, closesAtYmd: string): number | null {
  if (!isValidYmd(cookingYmd) || !isValidYmd(closesAtYmd)) return null;
  return daysBetweenYmd(closesAtYmd, cookingYmd);
}

export type DropSchedule = {
  date: Date;
  fulfilmentStartsAt: Date;
  fulfilmentEndsAt: Date;
  opensAt: Date | null;
  closesAt: Date;
};

/**
 * Move a drop's whole schedule to another IST day, keeping every time-of-day
 * and the gaps between them. IST has no DST, so shifting UTC instants by whole
 * days preserves the IST wall-clock times exactly.
 */
export function shiftDropSchedule(drop: DropSchedule, toYmd: string): DropSchedule {
  const shift = dayOffset(drop.date, toYmd) * DAY_MS;
  const move = (d: Date) => new Date(d.getTime() + shift);
  return {
    date: new Date(ymdToUtcMidnightMs(toYmd)),
    fulfilmentStartsAt: move(drop.fulfilmentStartsAt),
    fulfilmentEndsAt: move(drop.fulfilmentEndsAt),
    opensAt: drop.opensAt ? move(drop.opensAt) : null,
    closesAt: move(drop.closesAt),
  };
}

type StoredDropForForm = DropSchedule & {
  title: string;
  note: string | null;
  fulfilmentMode: DropUpsertInput["fulfilmentMode"];
  pickupNote: string | null;
  deliveryFeePaise: number;
  showEverydayMenu: boolean;
  items: {
    menuItemId: string;
    priceInPaise: number;
    maxQty: number | null;
    perOrderLimit: number | null;
    sortOrder: number;
  }[];
};

/** Stored drop → the IST-string shape `dropUpsertSchema` accepts (edit-form prefill). */
export function dropToFormInput(drop: StoredDropForForm): DropUpsertInput {
  const start = utcToIstParts(drop.fulfilmentStartsAt);
  const end = utcToIstParts(drop.fulfilmentEndsAt);
  const closes = utcToIstParts(drop.closesAt);
  const opens = drop.opensAt ? utcToIstParts(drop.opensAt) : null;
  return {
    title: drop.title,
    note: drop.note,
    date: dbDateToYmd(drop.date),
    fulfilmentMode: drop.fulfilmentMode,
    fulfilmentStart: start.hm,
    fulfilmentEnd: end.hm,
    pickupNote: drop.pickupNote,
    deliveryFeePaise: drop.deliveryFeePaise,
    opensAtDate: opens?.ymd ?? null,
    opensAtTime: opens?.hm ?? null,
    closesAtDate: closes.ymd,
    closesAtTime: closes.hm,
    showEverydayMenu: drop.showEverydayMenu,
    items: [...drop.items]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((i) => ({
        menuItemId: i.menuItemId,
        priceInPaise: i.priceInPaise,
        maxQty: i.maxQty,
        perOrderLimit: i.perOrderLimit,
        sortOrder: i.sortOrder,
      })),
  };
}

type CopyableDrop = DropSchedule & {
  title: string;
  note: string | null;
  fulfilmentMode: DropUpsertInput["fulfilmentMode"];
  pickupNote: string | null;
  deliveryFeePaise: number;
  showEverydayMenu: boolean;
};

/**
 * "Copy for tomorrow": the source drop's settings with its schedule moved to
 * `toYmd`. Everything the vendor configured carries over (including whether the
 * everyday menu shows alongside it); status, items and orders are the caller's.
 */
export function duplicateDropFields(src: CopyableDrop, toYmd: string) {
  return {
    title: src.title,
    note: src.note,
    fulfilmentMode: src.fulfilmentMode,
    pickupNote: src.pickupNote,
    deliveryFeePaise: src.deliveryFeePaise,
    showEverydayMenu: src.showEverydayMenu,
    ...shiftDropSchedule(src, toYmd),
  };
}

/**
 * Item sync on full replace: which existing DropItems disappear, and is any of
 * them blocked because buyers already ordered it?
 */
export function planDropItemRemoval(
  existing: { id: string; menuItemId: string; orderItemCount: number }[],
  incomingMenuItemIds: Iterable<string>,
): { deleteIds: string[]; blockedMenuItemId: string | null } {
  const keep = new Set(incomingMenuItemIds);
  const removed = existing.filter((e) => !keep.has(e.menuItemId));
  const blocked = removed.find((e) => e.orderItemCount > 0);
  return {
    deleteIds: blocked ? [] : removed.map((e) => e.id),
    blockedMenuItemId: blocked ? blocked.menuItemId : null,
  };
}

/** Upcoming = cooking day today or later (nearest first); past = earlier (newest first). */
export function groupDropsByDay<T extends { date: string }>(
  drops: T[],
  todayYmd: string,
): { upcoming: T[]; past: T[] } {
  const upcoming = drops.filter((d) => d.date >= todayYmd).sort((a, b) => a.date.localeCompare(b.date));
  const past = drops.filter((d) => d.date < todayYmd).sort((a, b) => b.date.localeCompare(a.date));
  return { upcoming, past };
}

/** Text label for every status — colour is a secondary cue only (a11y). */
export const DROP_STATUS_LABEL: Record<EffectiveDropStatus, string> = {
  DRAFT: "Draft",
  SCHEDULED: "Opens later",
  OPEN: "Taking orders",
  CLOSED: "Orders closed",
  FROZEN: "Orders frozen",
  FULFILLED: "Fulfilled",
};

/** Shared by `dropUpsertSchema` and the form's client-side check. */
export const PER_ORDER_OVER_MAX = "Max per order can't be more than how many you can make";

/** Plain-language messages for the 409 codes the drops API returns. */
export const DROP_CONFLICT_MESSAGE: Record<string, string> = {
  invalid_transition: "That change isn't possible from the drop's current state. Refresh and try again.",
  move_cutoff_first: "The order cut-off has already passed. Move the cut-off later, save, then reopen orders.",
  no_items: "Add at least one item before opening orders.",
  no_payment_method:
    "Customers have no way to pay yet. Add your UPI ID, or allow pay on delivery, in Settings → Payments.",
  storefront_not_published:
    "Your storefront is private, so customers can't see this drop. Switch on \"Publish my menu\" in Settings → Online store.",
  owner_required: "Only the owner can publish the store.",
  drop_locked: "Orders are frozen, so this drop can no longer be edited.",
  item_has_orders: "Customers have already ordered this item, so it can't be removed. Lower its quantity instead.",
  has_orders: "This drop has orders, so it can't be deleted. Close orders instead.",
  stale: "This drop was changed somewhere else. Refresh and try again.",
};
