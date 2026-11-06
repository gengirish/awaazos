import { describe, expect, it } from "vitest";

import { istToUtc } from "@/lib/drops-time";
import {
  findMenuSlot,
  menuSlotLabel,
  orderSlotLabel,
  parseMenuSlots,
  slotRuleDaysLabel,
  upcomingMenuSlots,
} from "@/lib/menu-slots";

// Thu 5 Nov 2026, 11:30 IST.
const NOW = istToUtc("2026-11-05", "11:30");
const WEEKDAYS_LUNCH = { days: [1, 2, 3, 4, 5, 6], start: "12:00", end: "14:00" };
const EVENINGS = { days: [0, 1, 2, 3, 4, 5, 6], start: "19:00", end: "21:00" };

describe("parseMenuSlots", () => {
  it("keeps valid rules and drops the rest", () => {
    expect(
      parseMenuSlots([
        WEEKDAYS_LUNCH,
        { days: [], start: "12:00", end: "13:00" },
        { days: [1], start: "14:00", end: "12:00" },
        { days: [9], start: "12:00", end: "13:00" },
        "junk",
      ]),
    ).toEqual([WEEKDAYS_LUNCH]);
    expect(parseMenuSlots(null)).toEqual([]);
    expect(parseMenuSlots({})).toEqual([]);
  });
});

describe("upcomingMenuSlots", () => {
  it("skips a slot starting within the lead time", () => {
    const slots = upcomingMenuSlots([WEEKDAYS_LUNCH], NOW);
    // Today's 12:00 starts in 30 min (< 60 min lead): the first slot is Fri.
    expect(slots[0].start).toEqual(istToUtc("2026-11-06", "12:00"));
  });

  it("covers the next 7 days on the rule's weekdays only", () => {
    const slots = upcomingMenuSlots([WEEKDAYS_LUNCH], NOW);
    // Fri, Sat, Mon, Tue, Wed (no Sunday; Thu 12:00 is too soon and next Thu is day 7).
    expect(slots.map((s) => s.start.toISOString())).toEqual(
      ["2026-11-06", "2026-11-07", "2026-11-09", "2026-11-10", "2026-11-11"].map((d) =>
        istToUtc(d, "12:00").toISOString(),
      ),
    );
  });

  it("orders slots from several rules by start", () => {
    const slots = upcomingMenuSlots([EVENINGS, WEEKDAYS_LUNCH], NOW);
    expect(slots[0].start).toEqual(istToUtc("2026-11-05", "19:00"));
    expect(slots[1].start).toEqual(istToUtc("2026-11-06", "12:00"));
    expect(slots[2].start).toEqual(istToUtc("2026-11-06", "19:00"));
  });

  it("returns nothing without rules", () => {
    expect(upcomingMenuSlots([], NOW)).toEqual([]);
  });
});

describe("findMenuSlot", () => {
  it("finds an offered slot by its key and refuses anything else", () => {
    const key = istToUtc("2026-11-06", "12:00").toISOString();
    expect(findMenuSlot([WEEKDAYS_LUNCH], key, NOW)?.end).toEqual(istToUtc("2026-11-06", "14:00"));
    // Too soon, not a rule time, or a Sunday.
    expect(findMenuSlot([WEEKDAYS_LUNCH], istToUtc("2026-11-05", "12:00").toISOString(), NOW)).toBeNull();
    expect(findMenuSlot([WEEKDAYS_LUNCH], istToUtc("2026-11-06", "12:30").toISOString(), NOW)).toBeNull();
    expect(findMenuSlot([WEEKDAYS_LUNCH], istToUtc("2026-11-08", "12:00").toISOString(), NOW)).toBeNull();
  });
});

describe("labels", () => {
  it("names the slot with its day", () => {
    const [first] = upcomingMenuSlots([EVENINGS], NOW);
    expect(menuSlotLabel(first, NOW)).toBe("Today · 7–9 pm");
  });

  it("an order without a slot has no label", () => {
    expect(orderSlotLabel(null, null, NOW)).toBeNull();
    expect(orderSlotLabel(istToUtc("2026-11-06", "12:00"), istToUtc("2026-11-06", "14:00"), NOW)).toBe(
      "Tomorrow · 12–2 pm",
    );
  });

  it("summarises a rule's days", () => {
    expect(slotRuleDaysLabel([0, 1, 2, 3, 4, 5, 6])).toBe("Every day");
    expect(slotRuleDaysLabel([1, 2, 3, 4, 5, 6])).toBe("Mon–Sat");
    expect(slotRuleDaysLabel([0, 5, 6])).toBe("Fri–Sun");
    expect(slotRuleDaysLabel([0, 6])).toBe("Sat, Sun");
  });
});
