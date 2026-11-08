/**
 * Where a store delivers (pure, client-safe, no zod: the store page ships it).
 *
 * `VendorSettings.deliveryAreas` is a list of localities, each with an optional
 * fee of its own: [{ name: "Kondapur", feePaise: 0 }, { name: "Madhapur", feePaise: null }].
 * `feePaise: null` means the usual fee (the drop's `deliveryFeePaise`, or the
 * menu's `menuDeliveryFeePaise`); a number replaces it for that area, for drops
 * and menu orders alike.
 *
 * Rules:
 *  1. An empty list means "anywhere": the buyer types their locality and pays
 *     the usual fee, as before areas existed.
 *  2. With areas set, a delivery goes only to one of them. Checkout offers the
 *     list instead of a free-text locality, and the server rejects any other
 *     locality (`outside_delivery_area`), so the fee is never a guess.
 *  3. Areas match on letters and digits only, ignoring case, spaces and
 *     punctuation ("Gachi-bowli " = "gachibowli"), so an old saved locality
 *     still matches.
 *  4. Pickup ignores areas.
 *
 * There is no radius: an order has no coordinates to measure, only a locality.
 */

import { formatINRCompact, rupeesToPaise } from "@/lib/currency";

export const MAX_DELIVERY_AREAS = 20;
export const DELIVERY_AREA_NAME_MAX = 40;
/** ₹1,000: the most one area's fee can be. */
export const MAX_DELIVERY_AREA_FEE_PAISE = 100_000;

export type DeliveryArea = { name: string; feePaise: number | null };

/**
 * A fee typed in rupees, as Settings → Online orders and setup read it:
 * "" → null (nothing entered); "30" / "12.50" / "0" → paise up to ₹1,000
 * (`MAX_DELIVERY_AREA_FEE_PAISE`, also the menu fee's ceiling); anything else
 * → undefined (invalid). Callers decide what an empty field means.
 */
export function deliveryFeeInputToPaise(raw: string): number | null | undefined {
  const t = raw.trim();
  if (t === "") return null;
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(t)) return undefined;
  try {
    const p = rupeesToPaise(Number(t));
    return p <= MAX_DELIVERY_AREA_FEE_PAISE ? p : undefined;
  } catch {
    return undefined;
  }
}

/** An area's fee as a list shows it: "Usual delivery fee", "Free delivery", "₹40 delivery". */
export function deliveryAreaFeeLabel(area: DeliveryArea): string {
  if (area.feePaise === null) return "Usual delivery fee";
  return area.feePaise === 0 ? "Free delivery" : `${formatINRCompact(area.feePaise)} delivery`;
}

/** The comparison key for an area or a buyer's locality (rule 3). */
export function deliveryAreaKey(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/** One stored or posted entry as an area, or null when it isn't one. */
export function toDeliveryArea(entry: unknown): DeliveryArea | null {
  if (!entry || typeof entry !== "object") return null;
  const { name, feePaise } = entry as { name?: unknown; feePaise?: unknown };
  if (typeof name !== "string") return null;
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed || trimmed.length > DELIVERY_AREA_NAME_MAX || !deliveryAreaKey(trimmed)) return null;
  if (feePaise === null || feePaise === undefined) return { name: trimmed, feePaise: null };
  if (typeof feePaise !== "number" || !Number.isInteger(feePaise)) return null;
  if (feePaise < 0 || feePaise > MAX_DELIVERY_AREA_FEE_PAISE) return null;
  return { name: trimmed, feePaise };
}

/** `VendorSettings.deliveryAreas` as areas: bad entries and repeats dropped, first spelling kept. */
export function parseDeliveryAreas(raw: unknown): DeliveryArea[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: DeliveryArea[] = [];
  for (const entry of raw) {
    const area = toDeliveryArea(entry);
    if (!area) continue;
    const key = deliveryAreaKey(area.name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(area);
    if (out.length === MAX_DELIVERY_AREAS) break;
  }
  return out;
}

/** The area a locality falls in, or null. */
export function findDeliveryArea(areas: readonly DeliveryArea[], locality: string | null | undefined): DeliveryArea | null {
  const key = deliveryAreaKey(locality ?? "");
  if (!key) return null;
  return areas.find((a) => deliveryAreaKey(a.name) === key) ?? null;
}

/** An area's fee: its own, or the usual one. */
export function areaFeePaise(area: DeliveryArea, baseFeePaise: number): number {
  return area.feePaise ?? baseFeePaise;
}

export type DeliveryFeeResult = { ok: true; feePaise: number; area: DeliveryArea | null } | { ok: false };

/** What a delivery to this locality costs, or `ok: false` when the store doesn't go there (rules 1–2). */
export function deliveryFeeFor(
  areas: readonly DeliveryArea[],
  locality: string | null | undefined,
  baseFeePaise: number,
): DeliveryFeeResult {
  if (areas.length === 0) return { ok: true, feePaise: baseFeePaise, area: null };
  const area = findDeliveryArea(areas, locality);
  return area ? { ok: true, feePaise: areaFeePaise(area, baseFeePaise), area } : { ok: false };
}

const SUMMARY_NAMES = 4;

function nameList(names: string[]): string {
  if (names.length <= SUMMARY_NAMES) return names.join(", ");
  return `${names.slice(0, SUMMARY_NAMES - 1).join(", ")} and ${names.length - (SUMMARY_NAMES - 1)} more`;
}

/**
 * The store page's line: "Free delivery in Kondapur, Gachibowli · ₹40 delivery
 * in Madhapur". Areas grouped by fee, free first, then cheapest. Null with no areas.
 */
export function deliveryAreaSummary(areas: readonly DeliveryArea[], baseFeePaise: number): string | null {
  if (areas.length === 0) return null;
  const byFee = new Map<number, string[]>();
  for (const a of areas) {
    const fee = areaFeePaise(a, baseFeePaise);
    byFee.set(fee, [...(byFee.get(fee) ?? []), a.name]);
  }
  return Array.from(byFee)
    .sort(([a], [b]) => a - b)
    .map(([fee, names]) =>
      fee === 0 ? `Free delivery in ${nameList(names)}` : `${formatINRCompact(fee)} delivery in ${nameList(names)}`,
    )
    .join(" · ");
}
