/**
 * Store page views for the leak map (lib/order-funnel.ts), kept in Upstash, not
 * Postgres: a write per buyer view would be the wrong shape for Neon, and a KV
 * counter costs nothing while nobody is looking.
 *
 * One hash per IST day, `funnel:v1:views:<YYYYMMDD>`, field `<vendorId>|<source>`,
 * kept 60 days. `funnel:v1:since` remembers when the first view was counted, so
 * the admin page can say "counted since DD/MM/YYYY" instead of guessing.
 *
 * Fail-open both ways, like lib/drops-signal.ts: no KV → nothing is counted and
 * the read returns null, which the page shows as "not tracked". No buyer data:
 * the store id, the day and the source column, nothing else.
 */
import { waitUntil } from "@vercel/functions";

import { formatBillDateYYYYMMDD } from "@/lib/billing-period";
import { getKv } from "@/lib/kv";
import { FUNNEL_SOURCES, type FunnelSource } from "@/lib/order-funnel";

const PREFIX = "funnel:v1";
const SINCE_KEY = `${PREFIX}:since`;
const TTL_SECONDS = 60 * 24 * 60 * 60;

export function viewsKey(day: Date): string {
  return `${PREFIX}:views:${formatBillDateYYYYMMDD(day)}`;
}

/** Counts one view in the background; never throws, never delays the page. */
export function countStoreView(vendorId: string, source: FunnelSource, now: Date = new Date()): void {
  const kv = getKv();
  if (!kv) return;
  const key = viewsKey(now);
  const p = kv
    .pipeline()
    .hincrby(key, `${vendorId}|${source}`, 1)
    .expire(key, TTL_SECONDS)
    .set(SINCE_KEY, now.toISOString(), { nx: true })
    .exec()
    .catch(() => {
      // A lost view is a smaller number on an admin page, never a broken store.
    });
  try {
    waitUntil(p);
  } catch {
    // Outside Vercel the promise simply runs on.
  }
}

function toCount(v: unknown): number {
  const n = typeof v === "number" ? v : Number.parseInt(String(v), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Views per source over the given IST days (each day's 00:00 IST instant), all
 * stores together. Null when KV is unavailable or the read fails.
 */
export async function readStoreViews(
  days: readonly Date[],
): Promise<{ since: Date | null; bySource: Record<FunnelSource, number> } | null> {
  const kv = getKv();
  if (!kv) return null;
  try {
    const p = kv.pipeline();
    p.get(SINCE_KEY);
    for (const d of days) p.hgetall(viewsKey(d));
    const [sinceRaw, ...hashes] = (await p.exec()) as [unknown, ...(Record<string, unknown> | null)[]];

    const bySource: Record<FunnelSource, number> = { instagram: 0, whatsapp: 0, direct: 0, other: 0 };
    for (const hash of hashes) {
      for (const [field, value] of Object.entries(hash ?? {})) {
        const source = field.slice(field.lastIndexOf("|") + 1);
        if ((FUNNEL_SOURCES as readonly string[]).includes(source)) bySource[source as FunnelSource] += toCount(value);
      }
    }
    const since = typeof sinceRaw === "string" ? new Date(sinceRaw) : null;
    return { since: since && !Number.isNaN(since.getTime()) ? since : null, bySource };
  } catch {
    return null;
  }
}
