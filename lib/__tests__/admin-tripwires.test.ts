import { describe, expect, it } from "vitest";

import {
  type DayCounts,
  type TripwireMetric,
  type TripwireRule,
  TRIPWIRE_RULES,
  evaluateTripwire,
  evaluateTripwires,
} from "@/lib/admin-tripwires";

const MS_PER_DAY = 86_400_000;
/** 02/11/2026 00:00 IST. */
const FIRST_DAY = new Date("2026-11-01T18:30:00.000Z");

function week(fill: (i: number) => Partial<Record<TripwireMetric, number>>): DayCounts[] {
  return Array.from({ length: 7 }, (_, i) => {
    const start = new Date(FIRST_DAY.getTime() + i * MS_PER_DAY);
    return {
      day: `2026-11-0${i + 2}`,
      start,
      counts: { instagramOrders: 0, storefrontOrders: 0, voiceBills: 0, counterPaidBills: 0, ...fill(i) },
    };
  });
}

const rule = (id: TripwireRule["id"]) => TRIPWIRE_RULES.find((r) => r.id === id)!;
const voice = rule("voice");
const untrackedInstagram: TripwireRule = { ...rule("instagram"), trackedSince: undefined };

describe("voice tripwire", () => {
  it("fires when no bill was voice for 7 days while counter bills were paid", () => {
    const result = evaluateTripwire(voice, week(() => ({ counterPaidBills: 2 })));
    expect(result.status).toBe("fired");
    expect(result.explanation).toContain("14 counter bills");
  });

  it("stays clear once a single voice bill shows up", () => {
    const days = week((i) => ({ counterPaidBills: 2, voiceBills: i === 6 ? 1 : 0 }));
    expect(evaluateTripwire(voice, days).status).toBe("clear");
  });

  it("stays clear when there were no counter bills at all (a real 0)", () => {
    const days = week(() => ({ storefrontOrders: 5 }));
    expect(evaluateTripwire(voice, days).status).toBe("clear");
  });
});

describe("instagram tripwire", () => {
  it("fires on 7 tracked days of 0 Instagram orders with storefront orders", () => {
    const result = evaluateTripwire(untrackedInstagram, week(() => ({ storefrontOrders: 1 })));
    expect(result).toMatchObject({ status: "fired", trackedDays: 7 });
    expect(result.explanation).toContain("7 storefront orders");
  });

  it("is clear with any Instagram order", () => {
    const days = week((i) => ({ storefrontOrders: 1, instagramOrders: i === 0 ? 1 : 0 }));
    expect(evaluateTripwire(untrackedInstagram, days).status).toBe("clear");
  });

  it("waits while tracking has under 7 days, counting only days that began after it started", () => {
    // orderChannel shipped 04/11 12:36 IST: 04/11 itself is partial, so 05/11..08/11 = 4 tracked days.
    const result = evaluateTripwire(rule("instagram"), week(() => ({ storefrontOrders: 3 })));
    expect(result).toMatchObject({ status: "waiting", trackedDays: 4, requiredDays: 7 });
  });

  it("counts a day that starts exactly at the tracking instant", () => {
    const since = new Date(FIRST_DAY.getTime() + 3 * MS_PER_DAY);
    const result = evaluateTripwire({ ...untrackedInstagram, trackedSince: since }, week(() => ({})), 4);
    expect(result.trackedDays).toBe(4);
  });
});

describe("evaluateTripwires", () => {
  it("returns one result per rule, in order", () => {
    expect(evaluateTripwires(week(() => ({}))).map((r) => r.id)).toEqual(["instagram", "voice"]);
  });
});
