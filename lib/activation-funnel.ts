/**
 * The activation funnel on /admin/bets: demo store created → claimed by the
 * seller → first paid bill, split by city. Pure and client-safe; the database
 * side is lib/admin-bets-server.ts. Definitions: docs/admin-redesign/PHASE-4.md.
 *
 * - Created: a DemoAuditLog "create" row (one per demo store, ever; deleted
 *   demos still count, they were made).
 * - Claimed: a DemoAuditLog "claim" row for the same store.
 * - First paid bill: the claimed store has at least one PAID, non-sample bill.
 *   Each stage is a subset of the one before.
 * - City: `Vendor.city` is free text, so it is grouped by a key read at render
 *   time (trimmed, spaces collapsed, lower case, a few old names mapped) and
 *   shown in title case ("navi mumbai" → "Navi Mumbai"). A store with no city, or one the
 *   internal API deleted for real, goes under "Unknown".
 */

export const UNKNOWN_CITY = "Unknown";

/** Old or alternate names that sellers still type. */
const CITY_ALIASES: Record<string, string> = {
  bangalore: "bengaluru",
  bombay: "mumbai",
  calcutta: "kolkata",
  madras: "chennai",
  gurgaon: "gurugram",
  "new delhi": "delhi",
  secunderabad: "hyderabad",
};

export function cityKey(city: string | null | undefined): string | null {
  const key = (city ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  if (!key) return null;
  return CITY_ALIASES[key] ?? key;
}

function titleCase(key: string): string {
  return key.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

export type ActivationStore = {
  vendorId: string;
  city: string | null;
  claimed: boolean;
  paid: boolean;
};

export type ActivationRow = { city: string; created: number; claimed: number; paid: number };

export type ActivationFunnel = { rows: ActivationRow[]; total: ActivationRow };

export function buildActivationFunnel(stores: readonly ActivationStore[]): ActivationFunnel {
  const groups = new Map<string, ActivationRow>();
  const seen = new Set<string>();
  for (const s of stores) {
    if (seen.has(s.vendorId)) continue;
    seen.add(s.vendorId);
    const key = cityKey(s.city);
    const row = groups.get(key ?? "") ?? { city: key ? titleCase(key) : UNKNOWN_CITY, created: 0, claimed: 0, paid: 0 };
    row.created += 1;
    if (s.claimed) row.claimed += 1;
    if (s.claimed && s.paid) row.paid += 1;
    groups.set(key ?? "", row);
  }

  const rows = [...groups.values()].sort(
    (a, b) =>
      Number(a.city === UNKNOWN_CITY) - Number(b.city === UNKNOWN_CITY) || b.created - a.created || a.city.localeCompare(b.city),
  );
  const total = rows.reduce(
    (t, r) => ({ ...t, created: t.created + r.created, claimed: t.claimed + r.claimed, paid: t.paid + r.paid }),
    { city: "All cities", created: 0, claimed: 0, paid: 0 },
  );
  return { rows, total };
}
