import { describe, expect, it } from "vitest";

import { TIMELINE_DAYS, buildTimeline, markerInputSchema, toMarkerOutput } from "@/lib/gtm-timeline";

/** 10/11/2026 10:00 IST: the timeline covers 11/09 to 09/11. */
const NOW = new Date("2026-11-10T04:30:00.000Z");
const ist = (s: string) => new Date(`${s}:00.000+05:30`);
const empty = { bills: [], demoCreatedAt: [], firstPaid: [], adminMarkers: [] };

describe("buildTimeline", () => {
  it("draws 60 empty days ending yesterday when nothing happened", () => {
    const t = buildTimeline({ now: NOW, ...empty });
    expect(t.days).toHaveLength(TIMELINE_DAYS);
    expect(t.days[0].ymd).toBe("2026-09-11");
    expect(t.days[59].ymd).toBe("2026-11-09");
    expect(t.markers).toEqual([]);
    expect(t.maxBills).toBe(0);
    expect(t.totalGmvPaise).toBe(0);
  });

  it("buckets bills by IST day and leaves today and earlier days out", () => {
    const t = buildTimeline({
      now: NOW,
      ...empty,
      bills: [
        { paidAt: ist("2026-11-09T23:59"), totalPaise: 10_000 },
        { paidAt: ist("2026-11-09T00:00"), totalPaise: 5_000 },
        { paidAt: ist("2026-11-08T23:59"), totalPaise: 2_500 },
        { paidAt: ist("2026-11-10T00:01"), totalPaise: 99_999 }, // today
        { paidAt: ist("2026-09-10T12:00"), totalPaise: 99_999 }, // before the window
      ],
    });
    expect(t.days[59]).toEqual({ ymd: "2026-11-09", gmvPaise: 15_000, bills: 2 });
    expect(t.days[58]).toEqual({ ymd: "2026-11-08", gmvPaise: 2_500, bills: 1 });
    expect(t.totalBills).toBe(3);
    expect(t.maxGmvPaise).toBe(15_000);
  });

  it("groups derived markers by day and numbers every marker in date order", () => {
    const t = buildTimeline({
      now: NOW,
      bills: [],
      demoCreatedAt: [ist("2026-11-02T10:00"), ist("2026-11-02T18:00"), ist("2026-10-20T09:00")],
      firstPaid: [
        { storeName: "Mitti Pottery", at: ist("2026-11-05T12:00") },
        { storeName: "Asha's Bakes", at: ist("2026-11-05T15:00") },
        { storeName: "Too Old", at: ist("2026-08-01T12:00") },
      ],
      adminMarkers: [
        { id: "m1", kind: "EVENT", label: "Sunday market", note: "Stall 14", occurredOn: new Date("2026-11-02T00:00:00.000Z") },
        { id: "m2", kind: "LAUNCH", label: "Old launch", note: null, occurredOn: new Date("2026-08-01T00:00:00.000Z") },
      ],
    });
    expect(t.markers.map((m) => [m.n, m.ymd, m.kind, m.label])).toEqual([
      [1, "2026-10-20", "demo", "1 demo store created"],
      [2, "2026-11-02", "event", "Sunday market"],
      [3, "2026-11-02", "demo", "2 demo stores created"],
      [4, "2026-11-05", "first_paid", "First paid bill: Asha's Bakes and Mitti Pottery"],
    ]);
    expect(t.markers[1]).toMatchObject({ id: "m1", note: "Stall 14", dayIndex: 52 });
    expect(t.markers[2].id).toBeNull();
  });

  it("shortens a long list of first paid bills", () => {
    const at = ist("2026-11-05T12:00");
    const t = buildTimeline({
      now: NOW,
      ...empty,
      firstPaid: ["D", "A", "C", "B"].map((storeName) => ({ storeName, at })),
    });
    expect(t.markers[0].label).toBe("First paid bill: A, B and 2 more");
  });
});

describe("markerInputSchema", () => {
  it("accepts a marker and refuses an empty label or a bad date", () => {
    expect(markerInputSchema.parse({ kind: "OUTREACH", label: " Instagram push ", occurredOn: "2026-11-03", note: "" })).toEqual({
      kind: "OUTREACH",
      label: "Instagram push",
      occurredOn: "2026-11-03",
      note: null,
    });
    expect(markerInputSchema.safeParse({ kind: "OUTREACH", label: "", occurredOn: "2026-11-03" }).success).toBe(false);
    expect(markerInputSchema.safeParse({ kind: "PARTY", label: "x", occurredOn: "2026-11-03" }).success).toBe(false);
    expect(markerInputSchema.safeParse({ kind: "EVENT", label: "x", occurredOn: "2026-11-31" }).success).toBe(false);
  });

  it("checks what the route sends back", () => {
    expect(
      toMarkerOutput({ id: "m1", kind: "EVENT", label: "x", note: null, occurredOn: new Date("2026-11-03T00:00:00.000Z") }),
    ).toEqual({ id: "m1", kind: "EVENT", label: "x", note: null, occurredOn: "2026-11-03" });
  });
});
