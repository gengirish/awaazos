/**
 * Database side of /admin/bets: bets, the GTM timeline and the activation funnel
 * (lib/admin-bets.ts, lib/gtm-timeline.ts, lib/activation-funnel.ts). Read on
 * page render only, never on a timer, so Neon can sleep. No seller or buyer
 * contact details are selected.
 */
import { REAL_SALES, istDayStart } from "@/lib/admin-metrics";
import { type ActivationFunnel, buildActivationFunnel } from "@/lib/activation-funnel";
import { TIMELINE_DAYS, type Timeline, buildTimeline } from "@/lib/gtm-timeline";
import { prisma } from "@/lib/prisma";

/** Undecided bets first, then by deadline; decided ones after, newest decision first. */
export async function loadBets() {
  const bets = await prisma.adminBet.findMany({
    select: {
      id: true,
      title: true,
      hypothesis: true,
      metricKey: true,
      targetValue: true,
      comparator: true,
      deadline: true,
      decision: true,
      notes: true,
      updatedAt: true,
    },
  });
  return bets.sort(
    (a, b) =>
      Number(a.decision !== "PENDING") - Number(b.decision !== "PENDING") ||
      (a.decision === "PENDING"
        ? a.deadline.getTime() - b.deadline.getTime()
        : b.updatedAt.getTime() - a.updatedAt.getTime()) ||
      a.title.localeCompare(b.title),
  );
}

export async function loadTimeline(now: Date): Promise<Timeline> {
  const start = istDayStart(TIMELINE_DAYS, now);
  const end = istDayStart(0, now);
  const paid = { ...REAL_SALES, paymentStatus: "PAID" } as const;
  // `@db.Date` keys are midnight UTC of the IST day; a day either side of the
  // window is read and buildTimeline keeps only the days it draws.
  const dateFrom = new Date(start.getTime() - 86_400_000);

  const [bills, demos, firstPaidRows, adminMarkers] = await Promise.all([
    prisma.transaction.findMany({
      where: { ...paid, paidAt: { gte: start, lt: end } },
      select: { paidAt: true, totalPaise: true },
    }),
    prisma.demoAuditLog.findMany({
      where: { action: "create", createdAt: { gte: start, lt: end } },
      select: { createdAt: true },
    }),
    prisma.transaction.groupBy({ by: ["vendorId"], where: paid, _min: { paidAt: true } }),
    prisma.adminTimelineMarker.findMany({
      where: { occurredOn: { gte: dateFrom, lte: end } },
      select: { id: true, kind: true, label: true, note: true, occurredOn: true },
    }),
  ]);

  const firsts = firstPaidRows.flatMap((r) =>
    r._min.paidAt && r._min.paidAt >= start && r._min.paidAt < end ? [{ vendorId: r.vendorId, at: r._min.paidAt }] : [],
  );
  const names = firsts.length
    ? await prisma.vendor.findMany({ where: { id: { in: firsts.map((f) => f.vendorId) } }, select: { id: true, name: true } })
    : [];
  const nameOf = new Map(names.map((v) => [v.id, v.name]));

  return buildTimeline({
    now,
    bills: bills.flatMap((b) => (b.paidAt ? [{ paidAt: b.paidAt, totalPaise: b.totalPaise }] : [])),
    demoCreatedAt: demos.map((d) => d.createdAt),
    firstPaid: firsts.map((f) => ({ storeName: nameOf.get(f.vendorId) ?? "A store", at: f.at })),
    adminMarkers,
  });
}

/** Every demo store ever created, whether it was claimed, and whether it then took a paid bill. */
export async function loadActivation(): Promise<ActivationFunnel> {
  const rows = await prisma.demoAuditLog.findMany({
    where: { action: { in: ["create", "claim"] }, vendorId: { not: null } },
    select: { action: true, vendorId: true },
  });
  const created = [...new Set(rows.filter((r) => r.action === "create").map((r) => r.vendorId!))];
  const claimed = new Set(rows.filter((r) => r.action === "claim").map((r) => r.vendorId!));
  if (created.length === 0) return buildActivationFunnel([]);

  const [vendors, paid] = await Promise.all([
    prisma.vendor.findMany({ where: { id: { in: created } }, select: { id: true, city: true } }),
    claimed.size
      ? prisma.transaction.groupBy({
          by: ["vendorId"],
          where: { vendorId: { in: [...claimed] }, paymentStatus: "PAID", isSample: false },
          _count: { _all: true },
        })
      : Promise.resolve([]),
  ]);
  const cityOf = new Map(vendors.map((v) => [v.id, v.city]));
  const paidSet = new Set(paid.map((p) => p.vendorId));

  return buildActivationFunnel(
    created.map((vendorId) => ({
      vendorId,
      city: cityOf.get(vendorId) ?? null,
      claimed: claimed.has(vendorId),
      paid: paidSet.has(vendorId),
    })),
  );
}
