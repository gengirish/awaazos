import { describe, expect, it } from "vitest";

import { BANNER_SNOOZE_DAYS, isBannerSnoozed, pickOrdersBanner } from "../orders-banner";

const DAY_MS = 24 * 60 * 60 * 1000;
const NONE = { reminder: false, install: false, survey: false, refer: false };

describe("pickOrdersBanner", () => {
  it("shows nothing when nothing is eligible", () => {
    expect(pickOrdersBanner(NONE)).toBeNull();
  });

  it("puts the FSSAI reminder above install, and install above the survey", () => {
    expect(pickOrdersBanner({ ...NONE, reminder: true, install: true, survey: true })).toBe("reminder");
    expect(pickOrdersBanner({ ...NONE, install: true, survey: true })).toBe("install");
    expect(pickOrdersBanner({ ...NONE, survey: true, refer: true })).toBe("survey");
  });

  it("shows a lower banner on its own", () => {
    expect(pickOrdersBanner({ ...NONE, survey: true })).toBe("survey");
    expect(pickOrdersBanner({ ...NONE, install: true })).toBe("install");
    expect(pickOrdersBanner({ ...NONE, refer: true })).toBe("refer");
  });
});

describe("isBannerSnoozed", () => {
  const now = 1_800_000_000_000;

  it("is not snoozed when nothing is stored", () => {
    expect(isBannerSnoozed(null, now)).toBe(false);
  });

  it("stays snoozed for the whole window, and lapses at its end", () => {
    expect(BANNER_SNOOZE_DAYS).toBe(7);
    expect(isBannerSnoozed(String(now), now)).toBe(true);
    expect(isBannerSnoozed(String(now - 7 * DAY_MS + 1), now)).toBe(true);
    expect(isBannerSnoozed(String(now - 7 * DAY_MS), now)).toBe(false);
  });

  it("lets the old permanent '1' flag lapse instead of hiding the prompt for good", () => {
    expect(isBannerSnoozed("1", now)).toBe(false);
  });

  it("does not hide a prompt on a bad value or a clock moved back", () => {
    expect(isBannerSnoozed("not-a-time", now)).toBe(false);
    expect(isBannerSnoozed(String(now + DAY_MS), now)).toBe(false);
  });
});
