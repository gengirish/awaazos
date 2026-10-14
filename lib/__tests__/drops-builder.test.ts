import { describe, expect, it } from "vitest";

import {
  addDaysYmd,
  cutoffLeadDays,
  daysBetweenYmd,
  dayOffset,
  defaultCutoffFor,
  defaultDropTitle,
  dropToFormInput,
  duplicateDropFields,
  groupDropsByDay,
  istTodayYmd,
  istTomorrowYmd,
  planDropItemRemoval,
  shiftDropSchedule,
  shiftOrderWindowDates,
} from "@/lib/drops-builder";
import { istToUtc, ymdToDbDate } from "@/lib/drops-time";
import { dropInputToData, dropUpsertSchema } from "@/lib/zod-drops";

describe("IST day helpers", () => {
  it("istTodayYmd rolls over at IST midnight, not UTC midnight", () => {
    expect(istTodayYmd(new Date("2026-10-05T18:29:59.000Z"))).toBe("2026-10-05");
    expect(istTodayYmd(new Date("2026-10-05T18:30:00.000Z"))).toBe("2026-10-06");
  });

  it("istTomorrowYmd handles month and year ends", () => {
    expect(istTomorrowYmd(new Date("2026-10-31T10:00:00.000Z"))).toBe("2026-11-01");
    expect(istTomorrowYmd(new Date("2026-12-31T19:00:00.000Z"))).toBe("2027-01-02");
  });

  it("addDaysYmd crosses leap day", () => {
    expect(addDaysYmd("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDaysYmd("2028-03-01", -1)).toBe("2028-02-29");
  });

  it("dayOffset counts whole days and rejects garbage", () => {
    expect(dayOffset(ymdToDbDate("2026-10-05"), "2026-10-06")).toBe(1);
    expect(dayOffset(ymdToDbDate("2026-10-05"), "2026-10-01")).toBe(-4);
    expect(() => dayOffset(ymdToDbDate("2026-10-05"), "06/10/2026")).toThrow();
  });
});

describe("defaultDropTitle", () => {
  it("names a new drop after its cooking day", () => {
    expect(defaultDropTitle("2026-10-17")).toBe("Saturday menu");
    expect(defaultDropTitle("2026-10-18")).toBe("Sunday menu");
  });

  it("is empty while the date input is cleared or invalid", () => {
    expect(defaultDropTitle("")).toBe("");
    expect(defaultDropTitle("2026-13-40")).toBe("");
  });
});

describe("shiftDropSchedule (copy for tomorrow)", () => {
  const src = {
    date: ymdToDbDate("2026-10-05"),
    fulfilmentStartsAt: istToUtc("2026-10-05", "17:00"),
    fulfilmentEndsAt: istToUtc("2026-10-05", "20:00"),
    opensAt: istToUtc("2026-10-03", "09:00"),
    closesAt: istToUtc("2026-10-04", "21:00"), // night before
  };

  it("keeps every IST wall-clock time and moves the day", () => {
    const out = shiftDropSchedule(src, "2026-10-06");
    expect(out.date.toISOString()).toBe("2026-10-06T00:00:00.000Z");
    expect(out.fulfilmentStartsAt).toEqual(istToUtc("2026-10-06", "17:00"));
    expect(out.fulfilmentEndsAt).toEqual(istToUtc("2026-10-06", "20:00"));
    expect(out.opensAt).toEqual(istToUtc("2026-10-04", "09:00"));
    expect(out.closesAt).toEqual(istToUtc("2026-10-05", "21:00"));
  });

  it("shifts across a month boundary by many days", () => {
    const out = shiftDropSchedule(src, "2026-11-02");
    expect(out.closesAt).toEqual(istToUtc("2026-11-01", "21:00"));
  });

  it("keeps a null opensAt null", () => {
    expect(shiftDropSchedule({ ...src, opensAt: null }, "2026-10-06").opensAt).toBeNull();
  });

  it("does not mutate the source", () => {
    const before = src.closesAt.getTime();
    shiftDropSchedule(src, "2026-10-09");
    expect(src.closesAt.getTime()).toBe(before);
  });
});

describe("dropToFormInput", () => {
  it("round-trips through dropUpsertSchema + dropInputToData", () => {
    const input = dropUpsertSchema.parse({
      title: "Saturday bakes",
      note: "Eggless",
      date: "2026-10-10",
      fulfilmentMode: "BOTH",
      fulfilmentStart: "17:00",
      fulfilmentEnd: "20:30",
      pickupNote: "Gate 2",
      deliveryFeePaise: 3000,
      opensAtDate: "2026-10-08",
      opensAtTime: "08:00",
      closesAtDate: "2026-10-09",
      closesAtTime: "21:00",
      items: [
        { menuItemId: "b", priceInPaise: 12000, maxQty: 20, perOrderLimit: 4, sortOrder: 1 },
        { menuItemId: "a", priceInPaise: 5000, sortOrder: 0 },
      ],
    });
    const stored = { ...dropInputToData(input), items: input.items };
    const back = dropToFormInput(stored);
    expect(back.date).toBe("2026-10-10");
    expect(back.fulfilmentStart).toBe("17:00");
    expect(back.fulfilmentEnd).toBe("20:30");
    expect(back.opensAtDate).toBe("2026-10-08");
    expect(back.opensAtTime).toBe("08:00");
    expect(back.closesAtDate).toBe("2026-10-09");
    expect(back.closesAtTime).toBe("21:00");
    expect(back.items.map((i) => i.menuItemId)).toEqual(["a", "b"]); // sorted by sortOrder
    expect(dropUpsertSchema.safeParse(back).success).toBe(true);
    expect(back.showEverydayMenu).toBe(false); // omitted on input → schema default
  });

  it.each([true, false])("round-trips showEverydayMenu = %s", (flag) => {
    const input = dropUpsertSchema.parse({
      title: "Biryani Sunday",
      date: "2026-10-11",
      fulfilmentMode: "PICKUP",
      fulfilmentStart: "12:00",
      fulfilmentEnd: "14:00",
      closesAtDate: "2026-10-11",
      closesAtTime: "10:00",
      showEverydayMenu: flag,
      items: [{ menuItemId: "a", priceInPaise: 25000 }],
    });
    const data = dropInputToData(input);
    expect(data.showEverydayMenu).toBe(flag);
    const back = dropToFormInput({ ...data, items: input.items });
    expect(back.showEverydayMenu).toBe(flag);
    expect(dropUpsertSchema.parse(back).showEverydayMenu).toBe(flag);
  });
});

describe("duplicateDropFields (copy for tomorrow)", () => {
  const src = {
    title: "Saturday bakes",
    note: "Eggless",
    fulfilmentMode: "BOTH" as const,
    pickupNote: "Gate 2",
    deliveryFeePaise: 3000,
    date: ymdToDbDate("2026-10-05"),
    fulfilmentStartsAt: istToUtc("2026-10-05", "17:00"),
    fulfilmentEndsAt: istToUtc("2026-10-05", "20:00"),
    opensAt: null,
    closesAt: istToUtc("2026-10-04", "21:00"),
  };

  it.each([true, false])("copies showEverydayMenu = %s", (flag) => {
    expect(duplicateDropFields({ ...src, showEverydayMenu: flag }, "2026-10-06").showEverydayMenu).toBe(flag);
  });

  it("copies settings and moves the schedule", () => {
    const out = duplicateDropFields({ ...src, showEverydayMenu: true }, "2026-10-06");
    expect(out).toMatchObject({
      title: "Saturday bakes",
      note: "Eggless",
      fulfilmentMode: "BOTH",
      pickupNote: "Gate 2",
      deliveryFeePaise: 3000,
      opensAt: null,
    });
    expect(out.date.toISOString()).toBe("2026-10-06T00:00:00.000Z");
    expect(out.closesAt).toEqual(istToUtc("2026-10-05", "21:00"));
    expect(Object.keys(out)).not.toContain("status");
  });
});

describe("planDropItemRemoval", () => {
  const existing = [
    { id: "di1", menuItemId: "m1", orderItemCount: 0 },
    { id: "di2", menuItemId: "m2", orderItemCount: 3 },
    { id: "di3", menuItemId: "m3", orderItemCount: 0 },
  ];

  it("deletes items no longer present when none have orders", () => {
    expect(planDropItemRemoval(existing, ["m2"])).toEqual({ deleteIds: ["di1", "di3"], blockedMenuItemId: null });
  });

  it("blocks the whole sync if a removed item has orders", () => {
    expect(planDropItemRemoval(existing, ["m1"])).toEqual({ deleteIds: [], blockedMenuItemId: "m2" });
  });

  it("is a no-op when everything is kept", () => {
    expect(planDropItemRemoval(existing, ["m1", "m2", "m3", "m4"])).toEqual({ deleteIds: [], blockedMenuItemId: null });
  });
});

describe("groupDropsByDay", () => {
  it("splits on today, nearest upcoming first, newest past first", () => {
    const drops = [{ date: "2026-10-01" }, { date: "2026-10-07" }, { date: "2026-10-05" }, { date: "2026-10-03" }];
    const { upcoming, past } = groupDropsByDay(drops, "2026-10-05");
    expect(upcoming.map((d) => d.date)).toEqual(["2026-10-05", "2026-10-07"]);
    expect(past.map((d) => d.date)).toEqual(["2026-10-03", "2026-10-01"]);
  });
});

describe("defaultCutoffFor", () => {
  it("closes the evening before the cooking day at 21:00 IST", () => {
    // Wed 7 Oct 2026, 12:00 IST; cooking Thu 8 Oct.
    expect(defaultCutoffFor("2026-10-08", new Date("2026-10-07T06:30:00.000Z"))).toEqual({
      closesAtDate: "2026-10-07",
      closesAtTime: "21:00",
    });
    // Same moment, cooking Sat 10 Oct → Fri 9 Oct, not today.
    expect(defaultCutoffFor("2026-10-10", new Date("2026-10-07T06:30:00.000Z"))).toEqual({
      closesAtDate: "2026-10-09",
      closesAtTime: "21:00",
    });
  });

  it("falls back to the cooking-day morning when the evening before is nearly over", () => {
    // Wed 7 Oct 20:00 IST = 14:30Z; cooking tomorrow.
    expect(defaultCutoffFor("2026-10-08", new Date("2026-10-07T14:30:00.000Z"))).toEqual({
      closesAtDate: "2026-10-08",
      closesAtTime: "10:00",
    });
    // 19:59 IST still gets the evening cut-off.
    expect(defaultCutoffFor("2026-10-08", new Date("2026-10-07T14:29:00.000Z")).closesAtTime).toBe("21:00");
  });

  it("falls back when the day before is already past (cooking today)", () => {
    expect(defaultCutoffFor("2026-10-07", new Date("2026-10-07T03:30:00.000Z"))).toEqual({
      closesAtDate: "2026-10-07",
      closesAtTime: "10:00",
    });
  });

  it("is accepted by dropUpsertSchema with the default 17:00 start", () => {
    const cutoff = defaultCutoffFor("2026-10-10", new Date("2026-10-07T06:30:00.000Z"));
    const r = dropUpsertSchema.safeParse({
      title: "Saturday bakes",
      date: "2026-10-10",
      fulfilmentMode: "DELIVERY",
      fulfilmentStart: "17:00",
      fulfilmentEnd: "20:00",
      ...cutoff,
      items: [{ menuItemId: "m1", priceInPaise: 12000 }],
    });
    expect(r.success).toBe(true);
  });
});

describe("shiftOrderWindowDates", () => {
  const untouched = { closesAtDate: false, opensAtDate: false };

  it("Thursday → Saturday moves a Wednesday 21:00 cut-off to Friday", () => {
    const window = { closesAtDate: "2026-10-07", closesAtTime: "21:00", opensAtDate: "2026-10-06" };
    const out = shiftOrderWindowDates(window, "2026-10-08", "2026-10-10", untouched);
    expect(out).toEqual({ closesAtDate: "2026-10-09", closesAtTime: "21:00", opensAtDate: "2026-10-08" });
    expect(cutoffLeadDays("2026-10-10", out.closesAtDate)).toBe(1);
  });

  it("shifts backwards too, across a month end", () => {
    const out = shiftOrderWindowDates(
      { closesAtDate: "2026-11-01", opensAtDate: "2026-10-31" },
      "2026-11-02",
      "2026-10-30",
      untouched,
    );
    expect(out).toEqual({ closesAtDate: "2026-10-29", opensAtDate: "2026-10-28" });
  });

  it("leaves a date the vendor edited by hand alone", () => {
    const out = shiftOrderWindowDates(
      { closesAtDate: "2026-10-07", opensAtDate: "2026-10-06" },
      "2026-10-08",
      "2026-10-10",
      { closesAtDate: true, opensAtDate: false },
    );
    expect(out).toEqual({ closesAtDate: "2026-10-07", opensAtDate: "2026-10-08" });
  });

  it("does nothing when either cooking day is blank or invalid", () => {
    const window = { closesAtDate: "2026-10-07", opensAtDate: "2026-10-06" };
    expect(shiftOrderWindowDates(window, "2026-10-08", "", untouched)).toBe(window);
    expect(shiftOrderWindowDates(window, "", "2026-10-10", untouched)).toBe(window);
  });

  it("keeps a blank order-window date blank", () => {
    const out = shiftOrderWindowDates({ closesAtDate: "", opensAtDate: "2026-10-06" }, "2026-10-08", "2026-10-09", untouched);
    expect(out).toEqual({ closesAtDate: "", opensAtDate: "2026-10-07" });
  });
});

describe("cutoffLeadDays / daysBetweenYmd", () => {
  it("counts whole days between cut-off and cooking day", () => {
    expect(cutoffLeadDays("2026-10-10", "2026-10-09")).toBe(1);
    expect(cutoffLeadDays("2026-10-10", "2026-10-07")).toBe(3);
    expect(cutoffLeadDays("2026-10-10", "2026-10-10")).toBe(0);
    expect(cutoffLeadDays("2026-10-10", "")).toBeNull();
    expect(daysBetweenYmd("2026-10-10", "2026-10-08")).toBe(-2);
  });
});
