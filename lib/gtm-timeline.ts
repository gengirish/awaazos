/**
 * The GTM timeline on /admin/bets: 60 IST days of paid bills and sales, with
 * markers for what happened on them. Pure and client-safe; the database side is
 * lib/admin-bets-server.ts. Definitions: docs/admin-redesign/PHASE-4.md.
 *
 * - Days are the 60 complete IST days before today, oldest first. Bills are
 *   PAID, not sample, on real stores, by `paidAt` (the same rule as the cards).
 * - Markers are typed by an admin (outreach, event, launch) or derived: a day
 *   demo stores were created (DemoAuditLog "create") and a day a store took its
 *   first ever paid bill. Derived markers group by day, so 3 demos on one day
 *   are one marker, not 3.
 * - Markers are numbered in date order; the chart draws the number, the list
 *   below says what it is, so nothing depends on colour.
 */
import { z } from "zod";

import { dateOnlyYmd, isRealYmd, istYmd, ymdToDateOnly } from "@/lib/admin-bets";

export const TIMELINE_DAYS = 60;
const DAY_MS = 86_400_000;

export type MarkerKind = "outreach" | "event" | "launch" | "demo" | "first_paid";

export const MARKER_KIND_LABEL: Record<MarkerKind, string> = {
  outreach: "Outreach",
  event: "Event",
  launch: "Launch",
  demo: "Demo stores",
  first_paid: "First paid bill",
};

export type TimelineDay = { ymd: string; gmvPaise: number; bills: number };

export type TimelineMarker = {
  /** 1-based, in date order: the number drawn on the chart. */
  n: number;
  /** Index into `days`. */
  dayIndex: number;
  ymd: string;
  kind: MarkerKind;
  label: string;
  note: string | null;
  /** Only admin markers have one (they can be deleted). */
  id: string | null;
};

export type Timeline = {
  days: TimelineDay[];
  markers: TimelineMarker[];
  maxGmvPaise: number;
  maxBills: number;
  totalGmvPaise: number;
  totalBills: number;
};

export type TimelineInput = {
  /** Any instant on today's IST date. */
  now: Date;
  bills: readonly { paidAt: Date; totalPaise: number }[];
  demoCreatedAt: readonly Date[];
  firstPaid: readonly { storeName: string; at: Date }[];
  adminMarkers: readonly {
    id: string;
    kind: "OUTREACH" | "EVENT" | "LAUNCH";
    label: string;
    note: string | null;
    /** `@db.Date`: midnight UTC of the IST day. */
    occurredOn: Date;
  }[];
};

/** "Asha's Bakes", "Asha's Bakes and Mitti", "Asha's Bakes, Mitti and 2 more". */
function nameList(names: readonly string[]): string {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

export function buildTimeline(input: TimelineInput): Timeline {
  const today = ymdToDateOnly(istYmd(input.now));
  const days: TimelineDay[] = Array.from({ length: TIMELINE_DAYS }, (_, i) => ({
    ymd: dateOnlyYmd(new Date(today.getTime() - (TIMELINE_DAYS - i) * DAY_MS)),
    gmvPaise: 0,
    bills: 0,
  }));
  const index = new Map(days.map((d, i) => [d.ymd, i]));

  for (const b of input.bills) {
    const i = index.get(istYmd(b.paidAt));
    if (i === undefined) continue;
    days[i].bills += 1;
    days[i].gmvPaise += b.totalPaise;
  }

  type Draft = Omit<TimelineMarker, "n">;
  const drafts: Draft[] = [];

  for (const m of input.adminMarkers) {
    const ymd = dateOnlyYmd(m.occurredOn);
    const i = index.get(ymd);
    if (i === undefined) continue;
    drafts.push({ dayIndex: i, ymd, kind: m.kind.toLowerCase() as MarkerKind, label: m.label, note: m.note, id: m.id });
  }

  const demosByDay = new Map<number, number>();
  for (const at of input.demoCreatedAt) {
    const i = index.get(istYmd(at));
    if (i !== undefined) demosByDay.set(i, (demosByDay.get(i) ?? 0) + 1);
  }
  for (const [i, count] of demosByDay) {
    drafts.push({
      dayIndex: i,
      ymd: days[i].ymd,
      kind: "demo",
      label: `${count} demo ${count === 1 ? "store" : "stores"} created`,
      note: null,
      id: null,
    });
  }

  const firstByDay = new Map<number, string[]>();
  for (const f of input.firstPaid) {
    const i = index.get(istYmd(f.at));
    if (i === undefined) continue;
    firstByDay.set(i, [...(firstByDay.get(i) ?? []), f.storeName]);
  }
  for (const [i, names] of firstByDay) {
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    drafts.push({
      dayIndex: i,
      ymd: days[i].ymd,
      kind: "first_paid",
      label: `First paid bill: ${nameList(sorted)}`,
      note: null,
      id: null,
    });
  }

  const kindOrder: MarkerKind[] = ["launch", "event", "outreach", "demo", "first_paid"];
  drafts.sort(
    (a, b) => a.dayIndex - b.dayIndex || kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind) || a.label.localeCompare(b.label),
  );

  return {
    days,
    markers: drafts.map((d, i) => ({ ...d, n: i + 1 })),
    maxGmvPaise: Math.max(0, ...days.map((d) => d.gmvPaise)),
    maxBills: Math.max(0, ...days.map((d) => d.bills)),
    totalGmvPaise: days.reduce((s, d) => s + d.gmvPaise, 0),
    totalBills: days.reduce((s, d) => s + d.bills, 0),
  };
}

// ─── API shapes ─────────────────────────────────────────────────────

export const MARKER_LABEL_MAX = 60;
export const MARKER_NOTE_MAX = 300;

/** POST /api/admin/timeline-markers. */
export const markerInputSchema = z.object({
  kind: z.enum(["OUTREACH", "EVENT", "LAUNCH"]),
  label: z.string().trim().min(1, "Say what happened").max(MARKER_LABEL_MAX),
  note: z
    .string()
    .trim()
    .max(MARKER_NOTE_MAX)
    .nullish()
    .transform((s) => (s ? s : null)),
  occurredOn: z
    .string()
    .refine(isRealYmd, "Pick a real date")
    .refine((s) => s >= "2026-01-01" && s <= "2030-12-31", "Pick a date between 2026 and 2030"),
});

export type MarkerInput = z.infer<typeof markerInputSchema>;

export const markerOutputSchema = z.object({
  id: z.string(),
  kind: z.enum(["OUTREACH", "EVENT", "LAUNCH"]),
  label: z.string(),
  note: z.string().nullable(),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export function toMarkerOutput(row: {
  id: string;
  kind: "OUTREACH" | "EVENT" | "LAUNCH";
  label: string;
  note: string | null;
  occurredOn: Date;
}) {
  return markerOutputSchema.parse({ ...row, occurredOn: dateOnlyYmd(row.occurredOn) });
}
